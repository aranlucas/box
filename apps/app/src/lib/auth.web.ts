// Web sign-in: the Worker sets an HttpOnly session cookie, sent automatically on same-origin requests.
export async function authHeader(): Promise<Record<string, string>> {
  return {};
}

export async function signIn(returnTo?: string): Promise<boolean> {
  const target = returnTo ?? window.location.pathname + window.location.search;
  window.location.href = `/auth/login?return=${encodeURIComponent(target)}`;
  return false; // navigation takes over
}

export async function signOut() {
  await fetch('/auth/logout', { method: 'POST' }).catch(() => {});
}
