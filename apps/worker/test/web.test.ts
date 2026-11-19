import { describe, expect, it, vi } from 'vitest';
import { serveWebFallback } from '../src/web.ts';

const origin = 'https://boxes.test';

describe('Expo web fallback', () => {
  it.each(['script', 'document'])(
    'returns a 404 for a missing bundle requested as a %s',
    async (destination) => {
      const assets = { fetch: vi.fn(async () => new Response('<!doctype html>')) };
      const response = await serveWebFallback(
        new Request(`${origin}/_expo/static/js/web/index-missing.js`, {
          headers: { 'sec-fetch-dest': destination },
        }),
        assets,
      );

      expect(response?.status).toBe(404);
      expect(response?.headers.get('content-type')).toContain('text/plain');
      expect(response?.headers.get('cache-control')).toBe('no-store');
      expect(assets.fetch).not.toHaveBeenCalled();
    },
  );

  it('serves the shell for a box deep link', async () => {
    const assets = { fetch: vi.fn(async () => new Response('<!doctype html>')) };
    const response = await serveWebFallback(new Request(`${origin}/b/ABC01234`), assets);

    expect(response?.status).toBe(200);
    expect(assets.fetch).toHaveBeenCalledWith(new URL('/', origin));
  });
});
