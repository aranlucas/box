import { env } from "cloudflare:workers";
import { Hono, type Context } from "hono";
import { randomToken, s256, safeReturnPath, sha256Hex } from "../util.ts";
import { authorizeUrl, exchangeCode, verifyIdToken } from "./oidc.ts";
import { createSession, endSession, setSessionCookie } from "./session.ts";

const REQUEST_TTL = 10 * 60 * 1000;
const NATIVE_CODE_TTL = 60 * 1000;
const NATIVE_REDIRECT = "boxes://auth";

export const authRoutes = new Hono();

async function upsertUser(sub: string, email: string | null, name: string | null): Promise<string> {
  const row = await env.DB.prepare(
    `INSERT INTO users (id, auth_sub, email, name, created_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(auth_sub) DO UPDATE SET email = excluded.email, name = excluded.name
     RETURNING id`,
  )
    .bind(randomToken(12), sub, email, name, Date.now())
    .first<{ id: string }>();
  return row!.id;
}

authRoutes.get("/auth/login", async (c) => {
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare("DELETE FROM auth_requests WHERE expires_at < ?").bind(now),
    env.DB.prepare("DELETE FROM native_codes WHERE expires_at < ?").bind(now),
  ]);
  const state = randomToken();
  const nonce = randomToken();
  const verifier = randomToken(48);
  const nativeChallenge = c.req.query("native_challenge") || null;
  await env.DB.prepare(
    "INSERT INTO auth_requests (state, verifier, nonce, return_to, native_challenge, expires_at) VALUES (?, ?, ?, ?, ?, ?)",
  )
    .bind(state, verifier, nonce, safeReturnPath(c.req.query("return")), nativeChallenge, now + REQUEST_TTL)
    .run();
  return c.redirect(authorizeUrl({ state, nonce, challenge: await s256(verifier), clientId: env.AUTH_CLIENT_ID }));
});

authRoutes.get("/auth/callback", async (c) => {
  const state = c.req.query("state") ?? "";
  const req = state
    ? await env.DB.prepare("DELETE FROM auth_requests WHERE state = ? RETURNING *")
        .bind(state)
        .first<{ verifier: string; nonce: string; return_to: string | null; native_challenge: string | null; expires_at: number }>()
    : null;
  const fail = (reason: string) =>
    req?.native_challenge
      ? c.redirect(`${NATIVE_REDIRECT}?error=${encodeURIComponent(reason)}`)
      : c.redirect(`/?auth_error=${encodeURIComponent(reason)}`);

  if (!req || req.expires_at < Date.now()) return fail("expired");
  const error = c.req.query("error");
  if (error) return fail(error);
  const code = c.req.query("code");
  if (!code) return fail("missing_code");

  let identity: { sub: string; email?: string; name?: string };
  try {
    const { id_token } = await exchangeCode({
      code,
      verifier: req.verifier,
      clientId: env.AUTH_CLIENT_ID,
      clientSecret: env.AUTH_CLIENT_SECRET,
    });
    identity = await verifyIdToken(id_token, { clientId: env.AUTH_CLIENT_ID, nonce: req.nonce });
  } catch (err) {
    console.error("Sign-in failed", err);
    return fail("sign_in_failed");
  }

  const userId = await upsertUser(identity.sub, identity.email ?? null, identity.name ?? null);
  const token = await createSession(userId);

  if (req.native_challenge) {
    const oneTime = randomToken();
    await env.DB.prepare("INSERT INTO native_codes (code_hash, session_token, challenge, expires_at) VALUES (?, ?, ?, ?)")
      .bind(await sha256Hex(oneTime), token, req.native_challenge, Date.now() + NATIVE_CODE_TTL)
      .run();
    return c.redirect(`${NATIVE_REDIRECT}?code=${encodeURIComponent(oneTime)}`);
  }
  setSessionCookie(c, token);
  return c.redirect(safeReturnPath(req.return_to ?? undefined));
});

// The Android app swaps its one-time code (+ PKCE-style verifier) for a session token.
authRoutes.post("/auth/native/exchange", async (c) => {
  const body = await c.req.json<{ code?: string; verifier?: string }>().catch(() => ({}) as { code?: string; verifier?: string });
  if (!body.code || !body.verifier) return c.json({ error: "Missing code or verifier" }, 400);
  const row = await env.DB.prepare("DELETE FROM native_codes WHERE code_hash = ? RETURNING *")
    .bind(await sha256Hex(body.code))
    .first<{ session_token: string; challenge: string; expires_at: number }>();
  if (!row || row.expires_at < Date.now() || (await s256(body.verifier)) !== row.challenge) {
    return c.json({ error: "Invalid or expired code" }, 400);
  }
  return c.json({ token: row.session_token });
});

authRoutes.post("/auth/logout", async (c) => {
  await endSession(c);
  return c.json({ ok: true });
});

// Local development only: sign in as a fake user without the auth service.
const isLocal = (c: Context) => ["127.0.0.1", "localhost"].includes(new URL(c.req.url).hostname);
authRoutes.get("/auth/dev-login", async (c) => {
  if (!isLocal(c)) return c.notFound();
  const sub = c.req.query("sub") || "dev";
  const userId = await upsertUser(`dev:${sub}`, `${sub}@dev.local`, c.req.query("name") || sub);
  const token = await createSession(userId);
  setSessionCookie(c, token);
  return c.json({ token, userId });
});
