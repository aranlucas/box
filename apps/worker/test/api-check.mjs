#!/usr/bin/env node
// Integration check for houses, invites, claim and house-scoped box access.
// Starts `cf dev` against a throwaway local D1/R2, runs the scenario, then stops it.
// Usage: node test/api-check.mjs        (from apps/worker)
import { spawn, execFileSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";

const PORT = 8799;
const B = `http://127.0.0.1:${PORT}`;
const DB_ID = "52c32efc-6ee3-48d8-8b4e-f41ad071a511";
const vars = readFileSync(".dev.vars", "utf8");
const KEY = /HOUSEHOLD_KEY=(.*)/.exec(vars)[1].trim();
const CLIENT_ID = /AUTH_CLIENT_ID=(.*)/.exec(vars)[1].trim();
const CLIENT_SECRET = /AUTH_CLIENT_SECRET=(.*)/.exec(vars)[1].trim();
const persist = mkdtempSync(join(tmpdir(), "bx-api-check-"));

// ---- Fake OIDC provider (stands in for auth.aranlucas.workers.dev) -------------------------
const { SignJWT, exportJWK, generateKeyPair } = await import("jose");
const OIDC_PORT = 8798;
const ISSUER = `http://127.0.0.1:${OIDC_PORT}/api/auth`;
const { publicKey, privateKey } = await generateKeyPair("RS256");
const jwk = { ...(await exportJWK(publicKey)), kid: "test", alg: "RS256", use: "sig" };
const b64url = (buf) => buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const s256 = (v) => b64url(createHash("sha256").update(v).digest());
const issued = new Map(); // code -> { nonce, challenge, sub, name }
const oidc = createServer(async (req, res) => {
  if (req.url === "/api/auth/jwks") return res.end(JSON.stringify({ keys: [jwk] }));
  if (req.url === "/api/auth/oauth2/token" && req.method === "POST") {
    let body = "";
    for await (const chunk of req) body += chunk;
    const form = new URLSearchParams(body);
    const basic = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString("base64");
    const grant = issued.get(form.get("code"));
    issued.delete(form.get("code"));
    if (req.headers.authorization !== `Basic ${basic}` || !grant || s256(form.get("code_verifier")) !== grant.challenge) {
      res.statusCode = 400;
      return res.end(JSON.stringify({ error: "invalid_grant" }));
    }
    const id_token = await new SignJWT({ nonce: grant.nonce, name: grant.name, email: `${grant.sub}@example.test` })
      .setProtectedHeader({ alg: "RS256", kid: "test" })
      .setIssuer(ISSUER)
      .setAudience(CLIENT_ID)
      .setSubject(grant.sub)
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(privateKey);
    res.setHeader("content-type", "application/json");
    return res.end(JSON.stringify({ id_token, access_token: "x", token_type: "Bearer" }));
  }
  res.statusCode = 404;
  res.end();
});
await new Promise((r) => oidc.listen(OIDC_PORT, "127.0.0.1", r));

execFileSync("cf", ["d1", "migrations", "apply", DB_ID, "--dir", "migrations", "--local", "--persist-to", persist], {
  stdio: "ignore",
});
const server = spawn("cf", ["dev", "--", "--port", String(PORT), "--host", "127.0.0.1"], {
  stdio: "ignore",
  detached: true,
  env: { ...process.env, BX_PERSIST: persist, BX_OIDC_ISSUER: ISSUER },
});
const stop = () => {
  try {
    process.kill(-server.pid);
  } catch {}
  oidc.close();
};
process.on("exit", stop);

async function waitUp() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`${B}/api/me`);
      if (r.status < 500) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("dev server did not start");
}

async function call(method, path, { token, key, house, json, form, cookie } = {}) {
  const headers = {};
  if (cookie) headers.cookie = cookie;
  if (token) headers.authorization = `Bearer ${token}`;
  if (key) headers["x-household-key"] = key;
  if (house) headers["x-house-id"] = house;
  let body;
  if (json) (headers["content-type"] = "application/json"), (body = JSON.stringify(json));
  if (form) body = form;
  const res = await fetch(`${B}${path}`, { method, headers, body, redirect: "manual" });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  return { status: res.status, data, headers: res.headers };
}

const PNG = Uint8Array.from(
  atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="),
  (ch) => ch.charCodeAt(0),
);
const photoForm = () => {
  const f = new FormData();
  f.append("photo", new Blob([PNG], { type: "image/png" }), "p.png");
  return f;
};
const login = async (sub) => (await call("GET", `/auth/dev-login?sub=${sub}&name=${sub}`)).data.token;
const cookieFrom = (res, name) => {
  const all = res.headers.getSetCookie?.() ?? [];
  const hit = all.find((c) => c.startsWith(`${name}=`));
  return hit ? hit.split(";")[0] : null;
};
/** Runs /auth/login → (fake provider) → /auth/callback. Returns the callback response. */
async function oidcFlow({ sub, name, nativeChallenge, sendStateCookie = true }) {
  const qs = nativeChallenge ? `?native_challenge=${nativeChallenge}` : "?return=/b/X";
  const start = await call("GET", `/auth/login${qs}`);
  assert.equal(start.status, 302);
  const auth = new URL(start.headers.get("location"));
  assert.equal(auth.origin + auth.pathname, `${ISSUER}/oauth2/authorize`);
  const code = b64url(randomBytes(16));
  issued.set(code, { nonce: auth.searchParams.get("nonce"), challenge: auth.searchParams.get("code_challenge"), sub, name });
  const stateCookie = cookieFrom(start, "bx_oauth");
  return call("GET", `/auth/callback?code=${code}&state=${auth.searchParams.get("state")}`, {
    cookie: sendStateCookie ? stateCookie : undefined,
  });
}
const sqliteFile = () => {
  const dir = join(persist, "v3", "d1", "miniflare-D1DatabaseObject");
  return join(dir, readdirSync(dir).find((f) => f.endsWith(".sqlite")));
};

let passed = 0;
async function check(name, fn) {
  await fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

try {
  await waitUp();
  const A = await login("alice");
  const Bob = await login("bob");
  const C = await login("carol");
  const D = await login("dave");

  await check("legacy key can create a Home box before claim", async () => {
    const r = await call("POST", "/api/boxes", { key: KEY, form: photoForm() });
    assert.equal(r.status, 201, JSON.stringify(r.data));
    assert.equal(r.data.box.number, 1);
  });
  const homeBox = (await call("GET", "/api/boxes", { key: KEY })).data.boxes[0].id;

  await check("/api/me reports Home as claimable and no houses", async () => {
    const r = await call("GET", "/api/me", { token: A });
    assert.equal(r.status, 200);
    assert.equal(r.data.user.name, "alice");
    assert.deepEqual(r.data.houses, []);
    assert.equal(r.data.legacyHomeClaimable, true);
  });

  await check("signed-out /api/me returns user null", async () => {
    const r = await call("GET", "/api/me");
    assert.equal(r.data.user, null);
  });

  await check("a user without a house cannot create one", async () => {
    const r = await call("POST", "/api/houses", { token: Bob, json: { name: "Nope" } });
    assert.equal(r.status, 403);
  });

  await check("claim with the wrong key fails", async () => {
    const r = await call("POST", "/api/houses/HOME0000/claim", { token: A, json: { key: "wrong" } });
    assert.equal(r.status, 403);
  });

  await check("alice claims Home with the key", async () => {
    const r = await call("POST", "/api/houses/HOME0000/claim", { token: A, json: { key: KEY } });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    const me = await call("GET", "/api/me", { token: A });
    assert.deepEqual(me.data.houses, [{ id: "HOME0000", name: "Home", role: "owner" }]);
    assert.equal(me.data.legacyHomeClaimable, false);
  });

  await check("legacy key stops working after the claim", async () => {
    assert.equal((await call("GET", "/api/boxes", { key: KEY })).status, 401);
    assert.equal((await call("POST", "/api/houses/HOME0000/claim", { token: Bob, json: { key: KEY } })).status, 409);
  });

  let invite;
  await check("owner creates an invite link", async () => {
    const r = await call("POST", "/api/houses/HOME0000/invites", { token: A });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.match(r.data.url, /^https:\/\/bx\.aranlucas\.workers\.dev\/invite\/[A-Za-z0-9_-]{20,}$/);
    invite = r.data.url.split("/invite/")[1];
  });

  await check("non-owner cannot create invites", async () => {
    assert.equal((await call("POST", "/api/houses/HOME0000/invites", { token: Bob })).status, 403);
  });

  await check("invite preview is public", async () => {
    const r = await call("GET", `/api/invites/${invite}`);
    assert.equal(r.status, 200);
    assert.deepEqual(r.data, { house_name: "Home", inviter_name: "alice", status: "valid" });
  });

  await check("bob accepts; accepting again is idempotent; carol gets 410 used", async () => {
    assert.equal((await call("POST", `/api/invites/${invite}/accept`, { token: Bob })).status, 200);
    assert.equal((await call("POST", `/api/invites/${invite}/accept`, { token: Bob })).status, 200);
    const r = await call("POST", `/api/invites/${invite}/accept`, { token: C });
    assert.equal(r.status, 410);
    assert.equal(r.data.status, "used");
  });

  await check("accepting requires sign-in", async () => {
    const inv2 = (await call("POST", "/api/houses/HOME0000/invites", { token: A })).data.url.split("/invite/")[1];
    assert.equal((await call("POST", `/api/invites/${inv2}/accept`)).status, 401);
  });

  await check("member bob lists Home boxes; still can't create a house", async () => {
    const r = await call("GET", "/api/boxes", { token: Bob, house: "HOME0000" });
    assert.equal(r.status, 200);
    assert.equal(r.data.boxes.length, 1);
    assert.equal((await call("POST", "/api/houses", { token: Bob, json: { name: "Mine" } })).status, 403);
  });

  await check("listing without membership is forbidden", async () => {
    assert.equal((await call("GET", "/api/boxes", { token: C, house: "HOME0000" })).status, 403);
    assert.equal((await call("GET", "/api/boxes", { token: C })).status, 400);
  });

  let garage, garageBox;
  await check("owner alice creates Garage; numbering restarts at 1", async () => {
    const h = await call("POST", "/api/houses", { token: A, json: { name: "Garage" } });
    assert.equal(h.status, 200, JSON.stringify(h.data));
    garage = h.data.house.id;
    const b = await call("POST", "/api/boxes", { token: A, house: garage, form: photoForm() });
    assert.equal(b.status, 201, JSON.stringify(b.data));
    assert.equal(b.data.box.number, 1);
    garageBox = b.data.box.id;
  });

  await check("edit responses keep can_edit true for members", async () => {
    const p = await call("PATCH", `/api/boxes/${garageBox}`, { token: A, json: { title: "Tools" } });
    assert.equal(p.status, 200);
    assert.equal(p.data.box.can_edit, true);
    const i = await call("PUT", `/api/boxes/${garageBox}/items`, { token: A, json: { items: [{ name: "hammer" }] } });
    assert.equal(i.data.box.can_edit, true);
  });

  await check("outsiders cannot modify a Garage box by id", async () => {
    for (const tok of [Bob, D]) {
      assert.equal((await call("PATCH", `/api/boxes/${garageBox}`, { token: tok, json: { title: "x" } })).status, 403);
      assert.equal((await call("PUT", `/api/boxes/${garageBox}/items`, { token: tok, json: { items: [] } })).status, 403);
      assert.equal((await call("POST", `/api/boxes/${garageBox}/photos`, { token: tok, form: photoForm() })).status, 403);
      assert.equal((await call("DELETE", `/api/boxes/${garageBox}`, { token: tok })).status, 403);
    }
  });

  await check("public box view works signed out, with can_edit reflecting membership", async () => {
    const anon = await call("GET", `/api/boxes/${garageBox}`);
    assert.equal(anon.status, 200);
    assert.equal(anon.data.box.can_edit, false);
    assert.equal((await call("GET", `/api/boxes/${garageBox}`, { token: A })).data.box.can_edit, true);
    assert.equal((await call("GET", `/api/boxes/${garageBox}`, { token: Bob })).data.box.can_edit, false);
  });

  await check("owner removes bob; bob loses edit access to Home", async () => {
    const m = await call("GET", "/api/houses/HOME0000/members", { token: A });
    assert.equal(m.status, 200);
    assert.equal(m.data.members.length, 2);
    const bobId = m.data.members.find((x) => x.name === "bob").user_id;
    assert.equal((await call("DELETE", `/api/houses/HOME0000/members/${bobId}`, { token: A })).status, 200);
    assert.equal((await call("PATCH", `/api/boxes/${homeBox}`, { token: Bob, json: { title: "x" } })).status, 403);
  });

  await check("the last owner cannot be removed", async () => {
    const m = await call("GET", "/api/houses/HOME0000/members", { token: A });
    const aliceId = m.data.members.find((x) => x.name === "alice").user_id;
    assert.equal((await call("DELETE", `/api/houses/HOME0000/members/${aliceId}`, { token: A })).status, 400);
  });

  await check("revoked invite returns 410 revoked", async () => {
    const r = await call("POST", "/api/houses/HOME0000/invites", { token: A });
    const tok = r.data.url.split("/invite/")[1];
    const list = await call("GET", "/api/houses/HOME0000/members", { token: A });
    const pending = list.data.invites;
    assert.ok(pending.length >= 1);
    for (const inv of pending) {
      assert.equal((await call("DELETE", `/api/houses/HOME0000/invites/${inv.id}`, { token: A })).status, 200);
    }
    const acc = await call("POST", `/api/invites/${tok}/accept`, { token: D });
    assert.equal(acc.status, 410);
    assert.equal(acc.data.status, "revoked");
  });

  await check("unknown invite is 404", async () => {
    assert.equal((await call("GET", "/api/invites/doesnotexist")).status, 404);
  });

  await check("logout ends the session", async () => {
    const t = await login("erin");
    assert.equal((await call("POST", "/auth/logout", { token: t })).status, 200);
    assert.equal((await call("GET", "/api/me", { token: t })).data.user, null);
  });

  await check("web sign-in: callback verifies the ID token and sets a session cookie", async () => {
    const cb = await oidcFlow({ sub: "oidc-web", name: "Web Person" });
    assert.equal(cb.status, 302);
    assert.equal(cb.headers.get("location"), "/b/X");
    const session = cookieFrom(cb, "bx_session");
    assert.ok(session, "bx_session cookie set");
    const me = await call("GET", "/api/me", { cookie: session });
    assert.equal(me.data.user.name, "Web Person");
    assert.equal(me.data.user.email, "oidc-web@example.test");
  });

  await check("signing in again keeps the same user (upsert by subject)", async () => {
    const first = await call("GET", "/api/me", { cookie: cookieFrom(await oidcFlow({ sub: "oidc-web", name: "Web Person" }), "bx_session") });
    const again = await call("GET", "/api/me", { cookie: cookieFrom(await oidcFlow({ sub: "oidc-web", name: "Renamed" }), "bx_session") });
    assert.equal(first.data.user.id, again.data.user.id);
    assert.equal(again.data.user.name, "Renamed");
  });

  await check("callback without the browser's state cookie is rejected (login CSRF)", async () => {
    const cb = await oidcFlow({ sub: "attacker", name: "Attacker", sendStateCookie: false });
    assert.equal(cb.status, 302);
    assert.match(cb.headers.get("location"), /^\/\?auth_error=/);
    assert.equal(cookieFrom(cb, "bx_session"), null);
  });

  await check("native sign-in: one-time code + verifier → bearer session; code is single-use", async () => {
    const verifier = b64url(randomBytes(32));
    const cb = await oidcFlow({ sub: "oidc-native", name: "Phone Person", nativeChallenge: s256(verifier) });
    assert.equal(cb.status, 302);
    const loc = cb.headers.get("location");
    assert.match(loc, /^boxes:\/\/auth\?code=/);
    assert.equal(cookieFrom(cb, "bx_session"), null, "native flow must not set a web cookie");
    const code = decodeURIComponent(loc.split("code=")[1]);
    const ex = await call("POST", "/auth/native/exchange", { json: { code, verifier } });
    assert.equal(ex.status, 200, JSON.stringify(ex.data));
    const me = await call("GET", "/api/me", { token: ex.data.token });
    assert.equal(me.data.user.name, "Phone Person");
    assert.equal((await call("POST", "/auth/native/exchange", { json: { code, verifier } })).status, 400);
  });

  await check("native exchange with the wrong verifier fails and burns the code", async () => {
    const verifier = b64url(randomBytes(32));
    const cb = await oidcFlow({ sub: "oidc-native", name: "Phone Person", nativeChallenge: s256(verifier) });
    const code = decodeURIComponent(cb.headers.get("location").split("code=")[1]);
    assert.equal((await call("POST", "/auth/native/exchange", { json: { code, verifier: "wrong" } })).status, 400);
    assert.equal((await call("POST", "/auth/native/exchange", { json: { code, verifier } })).status, 400);
  });

  await check("/auth/login points at the configured issuer with the exact redirect URI", async () => {
    const r = await call("GET", "/auth/login?return=/b/X");
    const loc = new URL(r.headers.get("location"));
    assert.equal(loc.searchParams.get("redirect_uri"), "https://bx.aranlucas.workers.dev/auth/callback");
    assert.equal(loc.searchParams.get("code_challenge_method"), "S256");
  });

  await check("expired invite returns 410 expired", async () => {
    const r = await call("POST", "/api/houses/HOME0000/invites", { token: A });
    const tok = r.data.url.split("/invite/")[1];
    execFileSync("sqlite3", [sqliteFile(), "UPDATE invites SET expires_at = 1 WHERE created_at = (SELECT MAX(created_at) FROM invites)"]);
    assert.equal((await call("GET", `/api/invites/${tok}`)).data.status, "expired");
    const acc = await call("POST", `/api/invites/${tok}/accept`, { token: D });
    assert.equal(acc.status, 410);
    assert.equal(acc.data.status, "expired");
  });

  await check("household-key guessing on claim is rate limited", async () => {
    const t = await login("guesser");
    const statuses = [];
    for (let i = 0; i < 8; i++) statuses.push((await call("POST", "/api/houses/HOME0000/claim", { token: t, json: { key: `guess${i}` } })).status);
    assert.ok(statuses.includes(429), `expected a 429, got ${statuses}`);
  });

  await check("uploads must really be images (HTML/SVG disguised as image/jpeg rejected)", async () => {
    for (const [body, type] of [["<html><script>alert(1)</script></html>", "image/jpeg"], ["<svg xmlns='http://www.w3.org/2000/svg'><script>1</script></svg>", "image/svg+xml"]]) {
      const f = new FormData();
      f.append("photo", new Blob([body], { type }), "x.jpg");
      const r = await call("POST", `/api/boxes/${garageBox}/photos`, { token: A, form: f });
      assert.equal(r.status, 415, `${type}: ${r.status}`);
    }
  });

  await check("photos are served with a safe type, nosniff and a sandboxing CSP", async () => {
    const box = (await call("GET", `/api/boxes/${garageBox}`)).data.box;
    const res = await fetch(`${B}/api/photos/${box.photos[0].id}`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type"), /^image\/(png|jpeg|webp|heic|heif|gif)$/);
    assert.equal(res.headers.get("x-content-type-options"), "nosniff");
    assert.match(res.headers.get("content-security-policy") ?? "", /sandbox/);
  });

  await check("item list replacement is rejected if the box changed since the editor loaded it", async () => {
    const before = (await call("GET", `/api/boxes/${garageBox}`, { token: A })).data.box;
    await call("PATCH", `/api/boxes/${garageBox}`, { token: A, json: { room: "Garage" } }); // someone else edits
    const stale = await call("PUT", `/api/boxes/${garageBox}/items`, { token: A, json: { items: [], if_updated_at: before.updated_at } });
    assert.equal(stale.status, 409);
    const fresh = (await call("GET", `/api/boxes/${garageBox}`, { token: A })).data.box;
    const ok = await call("PUT", `/api/boxes/${garageBox}/items`, { token: A, json: { items: [{ name: "saw" }], if_updated_at: fresh.updated_at } });
    assert.equal(ok.status, 200);
  });

  await check("two people racing for one invite: exactly one joins", async () => {
    const r = await call("POST", `/api/houses/${garage}/invites`, { token: A });
    const tok = r.data.url.split("/invite/")[1];
    const [p, q] = [await login("racer1"), await login("racer2")];
    const results = await Promise.all([p, q].map((t) => call("POST", `/api/invites/${tok}/accept`, { token: t })));
    assert.deepEqual(results.map((x) => x.status).sort(), [200, 410]);
    const members = (await call("GET", `/api/houses/${garage}/members`, { token: A })).data.members;
    assert.equal(members.filter((m) => m.name === "racer1" || m.name === "racer2").length, 1);
  });

  await check("wrong household keys are throttled on every route that checks them", async () => {
    const statuses = [];
    for (let i = 0; i < 70; i++) statuses.push((await call("GET", "/api/auth/check", { key: `wrong${i}` })).status);
    assert.ok(statuses.includes(429), `expected 429 among ${[...new Set(statuses)]}`);
  });

  await check("native exchange rejects a bad code", async () => {
    const r = await call("POST", "/auth/native/exchange", { json: { code: "nope", verifier: "x" } });
    assert.equal(r.status, 400);
  });

  console.log(`PASS (${passed} checks)`);
  stop();
  process.exit(0);
} catch (err) {
  console.error(`FAIL after ${passed} checks:`, err.message);
  stop();
  process.exit(1);
}
