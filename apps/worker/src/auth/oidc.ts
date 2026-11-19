import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";

declare const __BX_OIDC_ISSUER__: string | undefined;
const ISSUER_OVERRIDE = typeof __BX_OIDC_ISSUER__ === "string" ? __BX_OIDC_ISSUER__ : "";
export const ISSUER = ISSUER_OVERRIDE || "https://auth.aranlucas.workers.dev/api/auth";
export const REDIRECT_URI = "https://bx.aranlucas.workers.dev/auth/callback";
const SCOPE = "openid profile email";

let remoteJwks: JWTVerifyGetKey | undefined;

export function authorizeUrl(p: { state: string; nonce: string; challenge: string; clientId: string }): string {
  const u = new URL(`${ISSUER}/oauth2/authorize`);
  u.search = new URLSearchParams({
    response_type: "code",
    client_id: p.clientId,
    redirect_uri: REDIRECT_URI,
    scope: SCOPE,
    state: p.state,
    nonce: p.nonce,
    code_challenge: p.challenge,
    code_challenge_method: "S256",
  }).toString();
  return u.toString();
}

export async function exchangeCode(
  p: { code: string; verifier: string; clientId: string; clientSecret: string },
  fetchImpl: typeof fetch = fetch,
): Promise<{ id_token: string; access_token?: string; scope?: string }> {
  const res = await fetchImpl(`${ISSUER}/oauth2/token`, {
    method: "POST",
    headers: {
      authorization: `Basic ${btoa(`${p.clientId}:${p.clientSecret}`)}`,
      "content-type": "application/x-www-form-urlencoded",
      accept: "application/json",
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code: p.code,
      code_verifier: p.verifier,
      redirect_uri: REDIRECT_URI,
    }).toString(),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Token exchange failed (${res.status}): ${text.slice(0, 200)}`);
  const body = JSON.parse(text) as { id_token?: string; access_token?: string; scope?: string };
  if (!body.id_token) throw new Error("Token response had no id_token");
  return { id_token: body.id_token, access_token: body.access_token, scope: body.scope };
}

export type Identity = { sub: string; email?: string; name?: string };

/**
 * The auth service leaves name/email out of the ID token, so ask its userinfo endpoint.
 * Best effort: any failure (or a userinfo response for a different subject) just keeps `identity`.
 */
export async function withUserInfo(
  identity: Identity,
  accessToken: string | undefined,
  fetchImpl: typeof fetch = fetch,
): Promise<Identity> {
  if (!accessToken || (identity.name && identity.email)) return identity;
  try {
    const res = await fetchImpl(`${ISSUER}/oauth2/userinfo`, {
      headers: { authorization: `Bearer ${accessToken}`, accept: "application/json" },
    });
    if (!res.ok) {
      console.warn(`userinfo failed (${res.status})`);
      return identity;
    }
    const info = (await res.json()) as Record<string, unknown>;
    if (info.sub !== identity.sub) {
      console.warn("userinfo subject mismatch; ignoring");
      return identity;
    }
    const out = { ...identity };
    if (!out.email && typeof info.email === "string" && info.email) out.email = info.email;
    if (!out.name && typeof info.name === "string" && info.name) out.name = info.name;
    if (!out.name || !out.email) console.warn(`userinfo missing name/email; claims: ${Object.keys(info).join(",")}`);
    return out;
  } catch (err) {
    console.warn(`userinfo error: ${err instanceof Error ? err.message : String(err)}`);
    return identity;
  }
}

export async function verifyIdToken(
  idToken: string,
  p: { clientId: string; nonce: string; jwks?: JWTVerifyGetKey },
): Promise<Identity> {
  const jwks = p.jwks ?? (remoteJwks ??= createRemoteJWKSet(new URL(`${ISSUER}/jwks`)));
  const { payload } = await jwtVerify(idToken, jwks, {
    issuer: ISSUER,
    audience: p.clientId,
    algorithms: ["RS256"],
    requiredClaims: ["exp", "iat", "sub"],
  });
  if (payload.nonce !== p.nonce) throw new Error("ID token nonce mismatch");
  if (!payload.sub) throw new Error("ID token has no subject");
  const out: Identity = { sub: payload.sub };
  if (typeof payload.email === "string") out.email = payload.email;
  if (typeof payload.name === "string") out.name = payload.name;
  return out;
}
