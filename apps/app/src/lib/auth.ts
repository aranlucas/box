// Native sign-in: the Worker runs the OIDC flow in a browser tab and hands back a one-time code
// via boxes://auth, which we swap (with our PKCE-style verifier) for a session token.
import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import * as WebBrowser from 'expo-web-browser';

import { API_BASE } from './config';
import { toBase64 } from './util';

const TOKEN_KEY = 'session-token';
const REDIRECT = 'boxes://auth';
/** The stored session token, read from the keychain once per app start (null = signed out). */
let stored: Promise<string | null> | undefined;

const b64url = (b64: string) => b64.replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');

/** A query parameter of the boxes://auth return link. */
function queryParam(url: string, name: string): string | undefined {
  const value = new RegExp(`[?&]${name}=([^&#]*)`).exec(url)?.[1];
  return value === undefined ? undefined : decodeURIComponent(value);
}

export async function authHeader(): Promise<Record<string, string>> {
  stored ??= SecureStore.getItemAsync(TOKEN_KEY).catch(() => null);
  const token = await stored;
  return token ? { authorization: `Bearer ${token}` } : {};
}

/** Returns true when signed in; false if the user closed the sign-in tab. */
export async function signIn(_returnTo?: string): Promise<boolean> {
  const verifier = b64url(toBase64(Crypto.getRandomBytes(32)));
  const challenge = b64url(
    await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, verifier, {
      encoding: Crypto.CryptoEncoding.BASE64,
    }),
  );
  const result = await WebBrowser.openAuthSessionAsync(
    `${API_BASE}/auth/login?native_challenge=${encodeURIComponent(challenge)}`,
    REDIRECT,
  );
  if (result.type !== 'success') {
    return false;
  }
  const code = queryParam(result.url, 'code');
  if (!code) {
    throw new Error(`Sign-in failed (${queryParam(result.url, 'error') ?? 'no code'})`);
  }
  const res = await fetch(`${API_BASE}/auth/native/exchange`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code, verifier }),
  });
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the Worker's /auth/native/exchange response
  const body = (await res.json().catch(() => ({}))) as { token?: string; error?: string };
  if (!body.token) {
    throw new Error(body.error ?? 'Sign-in failed');
  }
  stored = Promise.resolve(body.token);
  await SecureStore.setItemAsync(TOKEN_KEY, body.token);
  return true;
}

export async function signOut() {
  const headers = await authHeader();
  await fetch(`${API_BASE}/auth/logout`, { method: 'POST', headers }).catch(() => {});
  stored = Promise.resolve(null);
  await SecureStore.deleteItemAsync(TOKEN_KEY).catch(() => {});
}
