// Native sign-in: the Worker runs the OIDC flow in a browser tab and hands back a one-time code
// via boxes://auth, which we swap (with our PKCE-style verifier) for a session token.
import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import * as WebBrowser from 'expo-web-browser';

import { API_BASE } from './config';

const TOKEN_KEY = 'session-token';
const REDIRECT = 'boxes://auth';
let token: string | null | undefined;

const b64url = (b64: string) => b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
function bytesToBase64(bytes: Uint8Array) {
  let s = '';
  for (let i = 0; i < bytes.length; i++) {
    s += String.fromCharCode(bytes[i]);
  }
  return btoa(s);
}
function queryParam(url: string, name: string): string | null {
  const m = new RegExp(`[?&]${name}=([^&#]*)`).exec(url);
  return m ? decodeURIComponent(m[1]) : null;
}

async function getToken() {
  if (token === undefined) {
    token = await SecureStore.getItemAsync(TOKEN_KEY).catch(() => null);
  }
  return token;
}

export async function authHeader(): Promise<Record<string, string>> {
  const t = await getToken();
  return t ? { authorization: `Bearer ${t}` } : {};
}

/** Returns true when signed in; false if the user closed the sign-in tab. */
export async function signIn(_returnTo?: string): Promise<boolean> {
  const verifier = b64url(bytesToBase64(Crypto.getRandomBytes(32)));
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
  const body = (await res.json().catch(() => ({}))) as { token?: string; error?: string };
  if (!res.ok || !body.token) {
    throw new Error(body.error ?? 'Sign-in failed');
  }
  token = body.token;
  await SecureStore.setItemAsync(TOKEN_KEY, body.token);
  return true;
}

export async function signOut() {
  const headers = await authHeader();
  await fetch(`${API_BASE}/auth/logout`, { method: 'POST', headers }).catch(() => {});
  token = null;
  await SecureStore.deleteItemAsync(TOKEN_KEY).catch(() => {});
}
