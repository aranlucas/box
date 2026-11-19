import * as oauth from 'oauth4webapi';

declare const __BX_OIDC_ISSUER__: string | undefined;
const ISSUER_OVERRIDE = typeof __BX_OIDC_ISSUER__ === 'string' ? __BX_OIDC_ISSUER__ : '';
export const ISSUER = ISSUER_OVERRIDE || 'https://auth.aranlucas.workers.dev/api/auth';
export const REDIRECT_URI = 'https://bx.aranlucas.workers.dev/auth/callback';
const SCOPE = 'openid profile email';

export type Identity = { sub: string; email?: string; name?: string };
export type OidcClient = { clientId: string; clientSecret: string };
/** Values saved when sign-in started, checked when the auth service redirects back. */
export type PendingSignIn = { state: string; nonce: string; verifier: string };

// Local dev may point at an http:// auth service (BX_OIDC_ISSUER); production is always https.
const insecure = ISSUER.startsWith('http://');

function requestOptions(fetchImpl?: typeof fetch) {
  return {
    ...(fetchImpl ? { [oauth.customFetch]: fetchImpl } : {}),
    ...(insecure ? { [oauth.allowInsecureRequests]: true } : {}),
  };
}

const clientOf = (c: Pick<OidcClient, 'clientId'>): oauth.Client => ({ client_id: c.clientId });

let discovered: Promise<oauth.AuthorizationServer> | undefined;

/** The auth service's OIDC metadata, fetched once per isolate (and again after a failure). */
export function authServer(fetchImpl?: typeof fetch): Promise<oauth.AuthorizationServer> {
  if (fetchImpl) {
    return discover(fetchImpl);
  }
  discovered ??= discover().catch((err) => {
    discovered = undefined;
    throw err;
  });
  return discovered;
}

async function discover(fetchImpl?: typeof fetch): Promise<oauth.AuthorizationServer> {
  const issuer = new URL(ISSUER);
  const res = await oauth.discoveryRequest(issuer, {
    algorithm: 'oidc',
    ...requestOptions(fetchImpl),
  });
  return oauth.processDiscoveryResponse(issuer, res);
}

/** Fresh state, nonce and PKCE verifier for one sign-in attempt. */
export function newSignIn(): PendingSignIn {
  return {
    state: oauth.generateRandomState(),
    nonce: oauth.generateRandomNonce(),
    verifier: oauth.generateRandomCodeVerifier(),
  };
}

export async function authorizeUrl(
  as: oauth.AuthorizationServer,
  client: Pick<OidcClient, 'clientId'>,
  p: PendingSignIn,
) {
  const u = new URL(as.authorization_endpoint!);
  u.search = new URLSearchParams({
    response_type: 'code',
    client_id: client.clientId,
    redirect_uri: REDIRECT_URI,
    scope: SCOPE,
    state: p.state,
    nonce: p.nonce,
    code_challenge: await oauth.calculatePKCECodeChallenge(p.verifier),
    code_challenge_method: 'S256',
  }).toString();
  return u.toString();
}

/**
 * Finish sign-in: check the redirect (state, iss, error), swap the code for tokens, validate the
 * ID token (issuer, audience, expiry, nonce), and fill in name/email from userinfo.
 * Throws oauth.AuthorizationResponseError when the auth service redirected back with an error.
 */
export async function completeSignIn(
  as: oauth.AuthorizationServer,
  client: OidcClient,
  callbackUrl: URL,
  pending: PendingSignIn,
  fetchImpl?: typeof fetch,
): Promise<Identity> {
  const c = clientOf(client);
  const params = oauth.validateAuthResponse(as, c, callbackUrl, pending.state);
  const res = await oauth.authorizationCodeGrantRequest(
    as,
    c,
    oauth.ClientSecretBasic(client.clientSecret),
    params,
    REDIRECT_URI,
    pending.verifier,
    requestOptions(fetchImpl),
  );
  const tokens = await oauth.processAuthorizationCodeResponse(as, c, res, {
    expectedNonce: pending.nonce,
    requireIdToken: true,
  });
  const claims = oauth.getValidatedIdTokenClaims(tokens)!;
  const identity: Identity = { sub: claims.sub };
  if (typeof claims.email === 'string' && claims.email) {
    identity.email = claims.email;
  }
  if (typeof claims.name === 'string' && claims.name) {
    identity.name = claims.name;
  }
  if (identity.name && identity.email) {
    return identity;
  }
  return withUserInfo(as, c, identity, tokens.access_token, fetchImpl);
}

/**
 * The auth service leaves name/email out of the ID token (they're served from userinfo), so ask
 * for them there. Best effort: any failure, including a response for another subject, keeps `identity`.
 */
async function withUserInfo(
  as: oauth.AuthorizationServer,
  client: oauth.Client,
  identity: Identity,
  accessToken: string,
  fetchImpl?: typeof fetch,
): Promise<Identity> {
  try {
    const res = await oauth.userInfoRequest(as, client, accessToken, requestOptions(fetchImpl));
    const info = await oauth.processUserInfoResponse(as, client, identity.sub, res);
    const out = { ...identity };
    if (!out.email && typeof info.email === 'string' && info.email) {
      out.email = info.email;
    }
    if (!out.name && typeof info.name === 'string' && info.name) {
      out.name = info.name;
    }
    if (!out.name || !out.email) {
      console.warn(`userinfo missing name/email; claims: ${Object.keys(info).join(',')}`);
    }
    return out;
  } catch (err) {
    console.warn(`userinfo failed: ${err instanceof Error ? err.message : String(err)}`);
    return identity;
  }
}
