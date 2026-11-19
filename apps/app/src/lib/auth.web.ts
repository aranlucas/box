// Web sign-in: the Worker sets an HttpOnly session cookie, sent automatically on same-origin requests.
// These mirror auth.ts (native), which is why they return promises.
export const authHeader = (): Promise<Record<string, string>> => Promise.resolve({});

export function signIn(returnTo?: string): Promise<boolean> {
  const target = returnTo ?? window.location.pathname + window.location.search;
  window.location.href = `/auth/login?return=${encodeURIComponent(target)}`;
  return Promise.resolve(false); // navigation takes over
}

export async function signOut() {
  // The session cookie is HttpOnly: only the server can end it, so a failed logout must not look successful.
  const res = await fetch('/auth/logout', { method: 'POST' }).catch(() => null);
  if (!res?.ok) {
    throw new Error('Could not sign out. Check your connection and try again.');
  }
}
