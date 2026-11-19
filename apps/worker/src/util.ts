const b64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

/** Random URL-safe token. */
export function randomToken(bytes = 32): string {
  return b64url(crypto.getRandomValues(new Uint8Array(bytes)));
}

export async function sha256Hex(s: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)));
  return Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** PKCE S256 code challenge for a verifier. */
export async function s256(verifier: string): Promise<string> {
  return b64url(
    new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))),
  );
}

const ORIGIN = 'https://bx.aranlucas.workers.dev';

/** Constant-time string comparison (compares SHA-256 digests so lengths don't leak). */
export async function safeEqual(a: string, b: string): Promise<boolean> {
  const [x, y] = await Promise.all([sha256Hex(a), sha256Hex(b)]);
  let diff = 0;
  for (let i = 0; i < x.length; i++) {
    diff |= x.charCodeAt(i) ^ y.charCodeAt(i);
  }
  return diff === 0;
}

/** Per-IP rate limit; true when the request may proceed. */
export async function allow(
  limiter: RateLimit,
  scope: string,
  ip: string | undefined,
): Promise<boolean> {
  const { success } = await limiter.limit({ key: `${scope}:${ip ?? 'unknown'}` });
  return success;
}

/**
 * Only same-origin paths; anything else falls back to "/". Control characters are rejected outright
 * (browsers strip tabs/newlines, so "/\t/evil.com" would become "//evil.com"), then the path is
 * resolved against our origin and must stay on it.
 */
export function safeReturnPath(p: string | undefined): string {
  // oxlint-disable-next-line no-control-regex -- Reject control characters in redirect paths.
  if (!p || !p.startsWith('/') || /[\x00-\x20\x7f\\]/.test(p)) {
    return '/';
  }
  try {
    const u = new URL(p, ORIGIN);
    // Dot-segments can normalize "/a/..//evil.com" to "//evil.com" (protocol-relative): reject.
    if (u.origin !== ORIGIN || u.pathname.startsWith('//')) {
      return '/';
    }
    return u.pathname + u.search + u.hash;
  } catch {
    return '/';
  }
}
