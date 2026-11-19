export function serveWebFallback(
  request: Request,
  assets: Pick<Fetcher, 'fetch'>,
): Promise<Response> | Response | undefined {
  const url = new URL(request.url);
  let path: string;
  try {
    path = decodeURIComponent(url.pathname);
  } catch {
    return undefined;
  }

  if (path.startsWith('/_expo/') || path.startsWith('/assets/')) {
    return new Response('404 Not Found', {
      status: 404,
      headers: { 'cache-control': 'no-store' },
    });
  }

  const destination = request.headers.get('sec-fetch-dest');
  if (
    (destination && destination !== 'document' && destination !== 'iframe') ||
    /^\/(?:api|B)(?:\/|$)|^\/auth\//.test(path) ||
    /\.[^/]+\/?$/.test(path)
  ) {
    return undefined;
  }

  // Serve Expo Router's shell for deep links. The visible URL is kept for the client router.
  return assets.fetch(new URL('/', url));
}
