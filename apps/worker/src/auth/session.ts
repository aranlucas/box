import type { User } from '@mj/api';
import { env } from 'cloudflare:workers';
import type { Context } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { randomToken, sha256Hex } from '../util.ts';

export type { User };

const SESSION_COOKIE = 'bx_session';
const DAY = 24 * 60 * 60 * 1000;
const TTL = 90 * DAY;
const SLIDE_BELOW = 60 * DAY;

/** Creates a session and returns the raw token (only its hash is stored). */
export async function createSession(userId: string): Promise<string> {
  const token = randomToken();
  const now = Date.now();
  await env.DB.prepare(
    'INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)',
  )
    .bind(await sha256Hex(token), userId, now + TTL, now)
    .run();
  return token;
}

export function setSessionCookie(c: Context, token: string) {
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    secure: true,
    sameSite: 'Lax',
    path: '/',
    maxAge: TTL / 1000,
  });
}

/** The session token: a bearer token from the native app, or the web cookie. */
function tokenFrom(c: Context): string | undefined {
  const auth = c.req.header('authorization');
  return auth?.startsWith('Bearer ') ? auth.slice(7).trim() : getCookie(c, SESSION_COOKIE);
}

/** Resolves the signed-in user from the session cookie or bearer token; slides the expiry. */
export async function userFromRequest(c: Context): Promise<User | null> {
  const token = tokenFrom(c);
  if (!token) {
    return null;
  }
  const hash = await sha256Hex(token);
  const row = await env.DB.prepare(
    `SELECT u.id, u.email, u.name, s.expires_at FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?`,
  )
    .bind(hash)
    .first<User & { expires_at: number }>();
  if (!row) {
    return null;
  }
  const { expires_at, ...user } = row;
  const now = Date.now();
  if (expires_at <= now) {
    await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(hash).run();
    return null;
  }
  if (expires_at - now < SLIDE_BELOW) {
    await env.DB.prepare('UPDATE sessions SET expires_at = ? WHERE token_hash = ?')
      .bind(now + TTL, hash)
      .run();
  }
  return user;
}

export async function endSession(c: Context) {
  const token = tokenFrom(c);
  if (token) {
    await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?')
      .bind(await sha256Hex(token))
      .run();
  }
  deleteCookie(c, SESSION_COOKIE, { path: '/', secure: true });
}
