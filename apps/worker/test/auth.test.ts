import { generateKeyPair, SignJWT } from "jose";
import { AuthorizationResponseError } from "oauth4webapi";
import { beforeAll, describe, expect, test } from "vitest";
import { authorizeUrl, authServer, completeSignIn, ISSUER, newSignIn, REDIRECT_URI } from "../src/auth/oidc.ts";
import { s256, safeReturnPath } from "../src/util.ts";

describe("safeReturnPath", () => {
  test("keeps same-origin paths", () => expect(safeReturnPath("/b/X")).toBe("/b/X"));
  test("rejects protocol-relative URLs", () => expect(safeReturnPath("//evil.com")).toBe("/"));
  test("rejects absolute URLs", () => expect(safeReturnPath("https://evil.com")).toBe("/"));
  test("rejects backslash tricks", () => expect(safeReturnPath("/\\evil.com")).toBe("/"));
  test("defaults when missing", () => expect(safeReturnPath(undefined)).toBe("/"));
  test("rejects tab-smuggled protocol-relative URLs", () => expect(safeReturnPath("/\t/evil.com")).toBe("/"));
  test("rejects newline-smuggled protocol-relative URLs", () => expect(safeReturnPath("/\n/evil.com")).toBe("/"));
  test("rejects paths that normalize to protocol-relative", () => expect(safeReturnPath("/a/..//evil.com")).toBe("/"));
  test("rejects dot-segment tricks that normalize to //", () => expect(safeReturnPath("/./%2e/..//evil.com")).toBe("/"));
  test("keeps query and hash", () => expect(safeReturnPath("/invite/abc?x=1#y")).toBe("/invite/abc?x=1#y"));
});

test("s256 matches the RFC 7636 test vector", async () => {
  expect(await s256("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
});

const CLIENT = { clientId: "cid", clientSecret: "sec" };
const PENDING = { state: "st", nonce: "n1", verifier: "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk" };
const callback = (params: Record<string, string>) =>
  new URL(`${REDIRECT_URI}?${new URLSearchParams({ code: "c1", state: "st", iss: ISSUER, ...params })}`);
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** A fake auth service: discovery, token and userinfo endpoints, recording every call. */
function fakeAuthService(opts: { idToken: () => Promise<string>; userinfo?: () => Response; token?: () => Response }) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = input instanceof Request ? input.url : String(input);
    calls.push({ url, init });
    if (url === `${ISSUER}/.well-known/openid-configuration`) {
      return json({
        issuer: ISSUER,
        authorization_endpoint: `${ISSUER}/oauth2/authorize`,
        token_endpoint: `${ISSUER}/oauth2/token`,
        userinfo_endpoint: `${ISSUER}/oauth2/userinfo`,
        jwks_uri: `${ISSUER}/jwks`,
        id_token_signing_alg_values_supported: ["RS256"],
        authorization_response_iss_parameter_supported: true,
      });
    }
    if (url === `${ISSUER}/oauth2/token`) {
      return opts.token?.() ?? json({ access_token: "at", token_type: "Bearer", expires_in: 3600, id_token: await opts.idToken() });
    }
    if (url === `${ISSUER}/oauth2/userinfo`) return opts.userinfo?.() ?? json({ sub: "user-123" });
    return new Response("not found", { status: 404 });
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}

describe("sign-in with the auth service", () => {
  let sign: (claims: Record<string, unknown>, o?: { aud?: string; iss?: string; exp?: string }) => Promise<string>;

  beforeAll(async () => {
    const { privateKey } = await generateKeyPair("RS256");
    sign = (claims, o = {}) =>
      new SignJWT(claims)
        .setProtectedHeader({ alg: "RS256", kid: "k1" })
        .setIssuer(o.iss ?? ISSUER)
        .setAudience(o.aud ?? "cid")
        .setSubject("user-123")
        .setIssuedAt()
        .setExpirationTime(o.exp ?? "5m")
        .sign(privateKey);
  });

  test("authorizeUrl targets the discovered endpoint with PKCE and the exact redirect URI", async () => {
    const { fetchImpl } = fakeAuthService({ idToken: () => sign({}) });
    const u = new URL(await authorizeUrl(await authServer(fetchImpl), CLIENT, PENDING));
    expect(u.origin + u.pathname).toBe(`${ISSUER}/oauth2/authorize`);
    expect(Object.fromEntries(u.searchParams)).toEqual({
      response_type: "code",
      client_id: "cid",
      redirect_uri: "https://bx.aranlucas.workers.dev/auth/callback",
      scope: "openid profile email",
      state: "st",
      nonce: "n1",
      // RFC 7636 Appendix B test vector for this verifier.
      code_challenge: "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
      code_challenge_method: "S256",
    });
  });

  test("newSignIn returns distinct random values", () => {
    const a = newSignIn();
    const b = newSignIn();
    expect(new Set([a.state, a.nonce, a.verifier, b.state, b.nonce, b.verifier]).size).toBe(6);
  });

  test("exchanges the code with HTTP Basic auth and PKCE, then reads name/email from userinfo", async () => {
    const { calls, fetchImpl } = fakeAuthService({
      idToken: () => sign({ nonce: "n1" }),
      userinfo: () => json({ sub: "user-123", name: "Ada", email: "ada@example.com" }),
    });
    const as = await authServer(fetchImpl);
    const identity = await completeSignIn(as, CLIENT, callback({}), PENDING, fetchImpl);
    expect(identity).toEqual({ sub: "user-123", name: "Ada", email: "ada@example.com" });

    const token = calls.find((c) => c.url === `${ISSUER}/oauth2/token`)!;
    expect(new Headers(token.init.headers).get("authorization")).toBe(`Basic ${btoa("cid:sec")}`);
    expect(Object.fromEntries(new URLSearchParams(String(token.init.body)))).toEqual({
      grant_type: "authorization_code",
      code: "c1",
      code_verifier: PENDING.verifier,
      redirect_uri: "https://bx.aranlucas.workers.dev/auth/callback",
    });
    const userinfo = calls.find((c) => c.url === `${ISSUER}/oauth2/userinfo`)!;
    expect(new Headers(userinfo.init.headers).get("authorization")).toBe("Bearer at");
  });

  test("skips userinfo when the ID token already has name and email", async () => {
    const { calls, fetchImpl } = fakeAuthService({ idToken: () => sign({ nonce: "n1", name: "Ada", email: "a@b.c" }) });
    const identity = await completeSignIn(await authServer(fetchImpl), CLIENT, callback({}), PENDING, fetchImpl);
    expect(identity).toEqual({ sub: "user-123", name: "Ada", email: "a@b.c" });
    expect(calls.some((c) => c.url.endsWith("/oauth2/userinfo"))).toBe(false);
  });

  test("ignores userinfo for a different subject", async () => {
    const { fetchImpl } = fakeAuthService({
      idToken: () => sign({ nonce: "n1" }),
      userinfo: () => json({ sub: "someone-else", name: "Eve", email: "eve@example.com" }),
    });
    expect(await completeSignIn(await authServer(fetchImpl), CLIENT, callback({}), PENDING, fetchImpl)).toEqual({ sub: "user-123" });
  });

  test("still signs in when userinfo fails", async () => {
    const { fetchImpl } = fakeAuthService({
      idToken: () => sign({ nonce: "n1" }),
      userinfo: () => json({ error: "invalid_token" }, 401),
    });
    expect(await completeSignIn(await authServer(fetchImpl), CLIENT, callback({}), PENDING, fetchImpl)).toEqual({ sub: "user-123" });
  });

  test("surfaces an error the auth service redirected back with", async () => {
    const { fetchImpl } = fakeAuthService({ idToken: () => sign({ nonce: "n1" }) });
    const err = await completeSignIn(await authServer(fetchImpl), CLIENT, callback({ error: "access_denied" }), PENDING, fetchImpl).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(AuthorizationResponseError);
    expect((err as AuthorizationResponseError).error).toBe("access_denied");
  });

  test.each([
    ["a different state", { state: "other" }],
    ["a different issuer on the redirect", { iss: "https://evil.example" }],
  ])("rejects a redirect with %s before calling the token endpoint", async (_name, params) => {
    const { calls, fetchImpl } = fakeAuthService({ idToken: () => sign({ nonce: "n1" }) });
    await expect(completeSignIn(await authServer(fetchImpl), CLIENT, callback(params), PENDING, fetchImpl)).rejects.toThrow();
    expect(calls.some((c) => c.url.endsWith("/oauth2/token"))).toBe(false);
  });

  test.each([
    ["the wrong audience", () => sign({ nonce: "n1" }, { aud: "other" })],
    ["the wrong issuer", () => sign({ nonce: "n1" }, { iss: "https://evil.example" })],
    ["a nonce mismatch", () => sign({ nonce: "other" })],
    ["an expired token", () => sign({ nonce: "n1" }, { exp: "-10m" })],
  ])("rejects an ID token with %s", async (_name, idToken) => {
    const { fetchImpl } = fakeAuthService({ idToken });
    await expect(completeSignIn(await authServer(fetchImpl), CLIENT, callback({}), PENDING, fetchImpl)).rejects.toThrow();
  });

  test("surfaces token endpoint errors", async () => {
    const { fetchImpl } = fakeAuthService({ idToken: () => sign({}), token: () => json({ error: "invalid_grant" }, 400) });
    await expect(completeSignIn(await authServer(fetchImpl), CLIENT, callback({}), PENDING, fetchImpl)).rejects.toThrow(
      /invalid_grant|server responded/,
    );
  });
});
