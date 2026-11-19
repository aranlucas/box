import { env } from 'cloudflare:workers';
import { Hono, type Context } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { AuthorizationResponseError } from 'oauth4webapi';
import { z } from 'zod';
import {
  allow,
  body,
  errorMessage,
  randomToken,
  s256,
  safeReturnPath,
  sha256Hex,
} from '../util.ts';
import { authorizeUrl, authServer, completeSignIn, newSignIn, type Identity } from './oidc.ts';
import { createSession, endSession, setSessionCookie } from './session.ts';

const REQUEST_TTL = 10 * 60 * 1000;
const NATIVE_CODE_TTL = 60 * 1000;
const NATIVE_REDIRECT = 'boxes://auth';
// Binds the OAuth `state` to the browser that started sign-in (prevents login CSRF).
const STATE_COOKIE = 'bx_oauth';
const STATE_COOKIE_OPTS = {
  httpOnly: true,
  secure: true,
  sameSite: 'Lax',
  path: '/auth/callback',
} as const;
export const authRoutes = new Hono();

/** Creates the user on first sign-in, refreshes name/email on later ones, and returns the user's id. */
async function upsertUser({ sub, email, name }: Identity): Promise<string> {
  const id = await env.DB.prepare(
    `INSERT INTO users (id, auth_sub, email, name, created_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(auth_sub) DO UPDATE SET email = COALESCE(excluded.email, users.email), name = COALESCE(excluded.name, users.name)
     RETURNING id`,
  )
    .bind(randomToken(12), sub, email ?? null, name ?? null, Date.now())
    .first<string>('id');
  if (!id) {
    throw new Error('users upsert returned no row');
  }
  return id;
}

authRoutes.get('/auth/login', async (c) => {
  if (!(await allow(env.LOGIN_LIMIT, 'login', c))) {
    return c.text('Too many sign-in attempts. Try again in a minute.', 429);
  }
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare('DELETE FROM auth_requests WHERE expires_at < ?').bind(now),
    env.DB.prepare('DELETE FROM native_codes WHERE expires_at < ?').bind(now),
  ]);
  const as = await authServer().catch((error: unknown) => {
    console.error(`OIDC discovery failed: ${errorMessage(error)}`);
  });
  if (!as) {
    return c.text('Sign-in is unavailable right now. Try again in a minute.', 503);
  }
  const pending = newSignIn();
  const { state, nonce, verifier } = pending;
  const nativeChallenge = c.req.query('native_challenge') || null;
  await env.DB.prepare(
    'INSERT INTO auth_requests (state, verifier, nonce, return_to, native_challenge, expires_at) VALUES (?, ?, ?, ?, ?, ?)',
  )
    .bind(
      state,
      verifier,
      nonce,
      safeReturnPath(c.req.query('return')),
      nativeChallenge,
      now + REQUEST_TTL,
    )
    .run();
  setCookie(c, STATE_COOKIE, state, { ...STATE_COOKIE_OPTS, maxAge: REQUEST_TTL / 1000 });
  return c.redirect(await authorizeUrl(as, { clientId: env.AUTH_CLIENT_ID }, pending));
});

authRoutes.get('/auth/callback', async (c) => {
  const state = c.req.query('state') ?? '';
  const browserState = getCookie(c, STATE_COOKIE);
  deleteCookie(c, STATE_COOKIE, STATE_COOKIE_OPTS);
  const req = state
    ? await env.DB.prepare('DELETE FROM auth_requests WHERE state = ? RETURNING *')
        .bind(state)
        .first<{
          verifier: string;
          nonce: string;
          return_to: string | null;
          native_challenge: string | null;
          expires_at: number;
        }>()
    : null;
  const fail = (reason: string) =>
    req?.native_challenge
      ? c.redirect(`${NATIVE_REDIRECT}?error=${encodeURIComponent(reason)}`)
      : c.redirect(`/?auth_error=${encodeURIComponent(reason)}`);

  if (!req || req.expires_at < Date.now()) {
    return fail('expired');
  }
  if (!browserState || browserState !== state) {
    return fail('state_mismatch');
  }

  let identity: Identity;
  try {
    identity = await completeSignIn(
      await authServer(),
      { clientId: env.AUTH_CLIENT_ID, clientSecret: env.AUTH_CLIENT_SECRET },
      new URL(c.req.url),
      { state, nonce: req.nonce, verifier: req.verifier },
    );
  } catch (error) {
    // The auth service sent the user back with an error (e.g. access_denied): pass its code on.
    if (error instanceof AuthorizationResponseError) {
      return fail(error.error);
    }
    console.error(`Sign-in failed: ${errorMessage(error)}`);
    return fail('sign_in_failed');
  }

  const userId = await upsertUser(identity);

  if (req.native_challenge) {
    // No session yet: it is minted only when the app proves it holds the verifier.
    const oneTime = randomToken();
    await env.DB.prepare(
      'INSERT INTO native_codes (code_hash, user_id, challenge, expires_at) VALUES (?, ?, ?, ?)',
    )
      .bind(await sha256Hex(oneTime), userId, req.native_challenge, Date.now() + NATIVE_CODE_TTL)
      .run();
    return c.redirect(`${NATIVE_REDIRECT}?code=${encodeURIComponent(oneTime)}`);
  }
  setSessionCookie(c, await createSession(userId));
  return c.redirect(safeReturnPath(req.return_to));
});

const proof = z.string('Missing code or verifier').min(1, 'Missing code or verifier');
const exchange = z.object({ code: proof, verifier: proof });

// The Android app swaps its one-time code (+ PKCE-style verifier) for a session token.
authRoutes.post('/auth/native/exchange', async (c) => {
  const { code, verifier } = await body(c, exchange);
  const row = await env.DB.prepare('DELETE FROM native_codes WHERE code_hash = ? RETURNING *')
    .bind(await sha256Hex(code))
    .first<{ user_id: string; challenge: string; expires_at: number }>();
  if (!row || row.expires_at < Date.now() || (await s256(verifier)) !== row.challenge) {
    return c.json({ error: 'Invalid or expired code' }, 400);
  }
  return c.json({ token: await createSession(row.user_id) });
});

authRoutes.post('/auth/logout', async (c) => {
  await endSession(c);
  return c.json({ ok: true });
});

// Local development only: sign in as a fake user without the auth service. Compiled out of
// production builds (__BX_DEV__ is false there) and additionally host-checked.
declare const __BX_DEV__: boolean;
const isLocal = (c: Context) => ['127.0.0.1', 'localhost'].includes(new URL(c.req.url).hostname);
authRoutes.get('/auth/dev-login', async (c) => {
  if (!__BX_DEV__ || !isLocal(c)) {
    return c.notFound();
  }
  const sub = c.req.query('sub') || 'dev';
  const userId = await upsertUser({
    sub: `dev:${sub}`,
    email: `${sub}@dev.local`,
    name: c.req.query('name') || sub,
  });
  const token = await createSession(userId);
  setSessionCookie(c, token);
  return c.json({ token, userId });
});
