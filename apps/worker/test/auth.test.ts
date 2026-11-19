import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";
import { beforeAll, describe, expect, test } from "vitest";
import { authorizeUrl, exchangeCode, ISSUER, REDIRECT_URI, verifyIdToken } from "../src/auth/oidc.ts";
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

test("authorizeUrl targets the auth service with PKCE and the exact redirect URI", () => {
  const u = new URL(authorizeUrl({ state: "st", nonce: "no", challenge: "ch", clientId: "cid" }));
  expect(u.origin + u.pathname).toBe(`${ISSUER}/oauth2/authorize`);
  expect(Object.fromEntries(u.searchParams)).toMatchObject({
    response_type: "code",
    client_id: "cid",
    redirect_uri: "https://bx.aranlucas.workers.dev/auth/callback",
    scope: "openid profile email",
    state: "st",
    nonce: "no",
    code_challenge: "ch",
    code_challenge_method: "S256",
  });
  expect(REDIRECT_URI).toBe("https://bx.aranlucas.workers.dev/auth/callback");
});

test("exchangeCode posts the code and verifier with HTTP Basic client auth", async () => {
  let seen: { url: string; init: RequestInit } | undefined;
  const fetchImpl = (async (url: string, init: RequestInit) => {
    seen = { url, init };
    return new Response(JSON.stringify({ id_token: "tok" }), { headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;
  const res = await exchangeCode({ code: "c1", verifier: "v1", clientId: "cid", clientSecret: "sec" }, fetchImpl);
  expect(res.id_token).toBe("tok");
  expect(seen!.url).toBe(`${ISSUER}/oauth2/token`);
  expect(new Headers(seen!.init.headers).get("authorization")).toBe(`Basic ${btoa("cid:sec")}`);
  const body = new URLSearchParams(seen!.init.body as string);
  expect(Object.fromEntries(body)).toEqual({
    grant_type: "authorization_code",
    code: "c1",
    code_verifier: "v1",
    redirect_uri: "https://bx.aranlucas.workers.dev/auth/callback",
  });
});

test("exchangeCode surfaces token endpoint errors", async () => {
  const fetchImpl = (async () => new Response('{"error":"invalid_grant"}', { status: 400 })) as unknown as typeof fetch;
  await expect(exchangeCode({ code: "c", verifier: "v", clientId: "a", clientSecret: "b" }, fetchImpl)).rejects.toThrow(
    /invalid_grant/,
  );
});

describe("verifyIdToken", () => {
  let sign: (claims: Record<string, unknown>, opts?: { exp?: string; aud?: string; iss?: string }) => Promise<string>;
  let jwks: ReturnType<typeof createLocalJWKSet>;

  beforeAll(async () => {
    const { publicKey, privateKey } = await generateKeyPair("RS256");
    const jwk = { ...(await exportJWK(publicKey)), kid: "k1", alg: "RS256" };
    jwks = createLocalJWKSet({ keys: [jwk] });
    sign = (claims, opts = {}) =>
      new SignJWT(claims)
        .setProtectedHeader({ alg: "RS256", kid: "k1" })
        .setIssuer(opts.iss ?? ISSUER)
        .setAudience(opts.aud ?? "cid")
        .setSubject("user-123")
        .setIssuedAt()
        .setExpirationTime(opts.exp ?? "5m")
        .sign(privateKey);
  });

  test("accepts a valid token and returns identity", async () => {
    const t = await sign({ nonce: "n1", email: "a@b.c", name: "Ada" });
    expect(await verifyIdToken(t, { clientId: "cid", nonce: "n1", jwks })).toEqual({
      sub: "user-123",
      email: "a@b.c",
      name: "Ada",
    });
  });
  test("rejects the wrong audience", async () => {
    const t = await sign({ nonce: "n1" }, { aud: "other" });
    await expect(verifyIdToken(t, { clientId: "cid", nonce: "n1", jwks })).rejects.toThrow();
  });
  test("rejects the wrong issuer", async () => {
    const t = await sign({ nonce: "n1" }, { iss: "https://evil.example" });
    await expect(verifyIdToken(t, { clientId: "cid", nonce: "n1", jwks })).rejects.toThrow();
  });
  test("rejects a nonce mismatch", async () => {
    const t = await sign({ nonce: "other" });
    await expect(verifyIdToken(t, { clientId: "cid", nonce: "n1", jwks })).rejects.toThrow(/nonce/);
  });
  test("rejects a token without exp", async () => {
    const { publicKey, privateKey } = await generateKeyPair("RS256");
    const jwk = { ...(await exportJWK(publicKey)), kid: "k2", alg: "RS256" };
    const t = await new SignJWT({ nonce: "n1" })
      .setProtectedHeader({ alg: "RS256", kid: "k2" })
      .setIssuer(ISSUER)
      .setAudience("cid")
      .setSubject("u")
      .setIssuedAt()
      .sign(privateKey);
    await expect(verifyIdToken(t, { clientId: "cid", nonce: "n1", jwks: createLocalJWKSet({ keys: [jwk] }) })).rejects.toThrow();
  });
  test("rejects an expired token", async () => {
    const t = await sign({ nonce: "n1" }, { exp: "-10m" });
    await expect(verifyIdToken(t, { clientId: "cid", nonce: "n1", jwks })).rejects.toThrow();
  });
});
