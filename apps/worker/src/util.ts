import type { Context } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { z } from 'zod';

/** Where this Worker is deployed; printed into invite links and the OIDC redirect URI. */
export const PUBLIC_ORIGIN = 'https://bx.aranlucas.workers.dev';

const b64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '');

const sha256 = async (s: string) =>
  new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)));

/** Random URL-safe token. */
export function randomToken(bytes = 32): string {
  return b64url(crypto.getRandomValues(new Uint8Array(bytes)));
}

export async function sha256Hex(s: string): Promise<string> {
  return Array.from(await sha256(s), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** PKCE S256 code challenge for a verifier. */
export async function s256(verifier: string): Promise<string> {
  return b64url(await sha256(verifier));
}

/** Per-IP rate limit; true when the request may proceed. */
export async function allow(limiter: RateLimit, scope: string, c: Context): Promise<boolean> {
  const { success } = await limiter.limit({
    key: `${scope}:${c.req.header('cf-connecting-ip') ?? 'unknown'}`,
  });
  return success;
}

export const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

/**
 * The request's JSON body, checked against `schema`. Request bodies are the one place the types
 * can't be trusted, so every route parses here and works with the result as typed.
 */
export async function body<T>(c: Context, schema: z.ZodType<T>): Promise<T> {
  const parsed = schema.safeParse(await c.req.json().catch(() => undefined));
  if (parsed.success) {
    return parsed.data;
  }
  throw new HTTPException(400, { message: parsed.error.issues[0]?.message ?? 'Invalid request' });
}

/**
 * Only same-origin paths; anything else falls back to "/". Control characters are rejected outright
 * (browsers strip tabs/newlines, so "/\t/evil.com" would become "//evil.com"), then the path is
 * resolved against our origin and must stay on it.
 */
export function safeReturnPath(p: string | null | undefined): string {
  // oxlint-disable-next-line no-control-regex -- rejecting control characters is the point
  if (!p?.startsWith('/') || /[\u0000-\u0020\u007F\\]/.test(p)) {
    return '/';
  }
  try {
    const u = new URL(p, PUBLIC_ORIGIN);
    // Dot-segments can normalize "/a/..//evil.com" to "//evil.com" (protocol-relative): reject.
    if (u.origin !== PUBLIC_ORIGIN || u.pathname.startsWith('//')) {
      return '/';
    }
    return u.pathname + u.search + u.hash;
  } catch {
    return '/';
  }
}
