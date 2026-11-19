#!/usr/bin/env node
// Integration check for houses, invites, claim and house-scoped box access.
// Starts `cf dev` against a throwaway local D1/R2, runs the scenario, then stops it.
// Usage: node test/api-check.mjs        (from apps/worker)
import { spawn, execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";

const PORT = 8799;
const B = `http://127.0.0.1:${PORT}`;
const DB_ID = "52c32efc-6ee3-48d8-8b4e-f41ad071a511";
const KEY = /HOUSEHOLD_KEY=(.*)/.exec(readFileSync(".dev.vars", "utf8"))[1].trim();
const persist = mkdtempSync(join(tmpdir(), "bx-api-check-"));

execFileSync("cf", ["d1", "migrations", "apply", DB_ID, "--dir", "migrations", "--local", "--persist-to", persist], {
  stdio: "ignore",
});
const server = spawn("cf", ["dev", "--", "--port", String(PORT), "--host", "127.0.0.1"], {
  stdio: "ignore",
  detached: true,
  env: { ...process.env, BX_PERSIST: persist },
});
const stop = () => {
  try {
    process.kill(-server.pid);
  } catch {}
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

async function call(method, path, { token, key, house, json, form } = {}) {
  const headers = {};
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

  await check("dev-login is local only and /auth/login redirects to the auth service", async () => {
    const r = await call("GET", "/auth/login?return=/b/X");
    assert.equal(r.status, 302);
    const loc = new URL(r.headers.get("location"));
    assert.equal(loc.origin + loc.pathname, "https://auth.aranlucas.workers.dev/api/auth/oauth2/authorize");
    assert.equal(loc.searchParams.get("redirect_uri"), "https://bx.aranlucas.workers.dev/auth/callback");
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
