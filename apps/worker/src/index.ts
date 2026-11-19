import type { Box, BoxRow, BoxStatus, Item, Photo } from '@box/api';
import { env } from 'cloudflare:workers';
import { Hono, type Context } from 'hono';
import { createMiddleware } from 'hono/factory';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import { extractContents, TITLE_MAX, type Extraction } from './ai.ts';
import { authRoutes } from './auth/routes.ts';
import { userFromRequest } from './auth/session.ts';
import { canAccessHouse, enterHouse, houseRoutes, requireHouse, type HouseEnv } from './houses.ts';
import { printingRoutes } from './printing.ts';
import { searchBoxes } from './search.ts';
import { body } from './util.ts';
import { serveWebFallback } from './web.ts';

// Crockford base32 (no I, L, O, U): uppercase-only so it survives QR alphanumeric mode.
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
function randomId(len: number): string {
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  return Array.from(bytes, (b) => ALPHABET.charAt(b & 31)).join('');
}
const newBoxId = () => randomId(8); // 40 bits
const newRowId = () => randomId(16);

/** The `:id` path parameter. QR codes carry ids uppercased, links may not. */
const pid = (c: Context) => (c.req.param('id') ?? '').toUpperCase();

const app = new Hono();

// QR codes encode the URL uppercased (denser QR). Normalise /B/XXXX → /b/XXXX for the SPA router.
app.get('/B/:id', (c) => c.redirect(`/b/${pid(c)}`, 301));

const api = new Hono<HouseEnv>();

/** Box-by-id: the caller must belong to the box's own house. */
const requireBoxAccess = createMiddleware<HouseEnv>(async (c, next) => {
  const houseId = await env.DB.prepare('SELECT house_id FROM boxes WHERE id = ?')
    .bind(pid(c))
    .first<string>('house_id');
  if (!houseId) {
    return c.json({ error: 'Not found' }, 404);
  }
  return (await enterHouse(c, houseId)) ?? next();
});

async function loadBox(id: string): Promise<Omit<Box, 'can_edit'> | null> {
  const [box, items, photos] = await Promise.all([
    env.DB.prepare('SELECT * FROM boxes WHERE id = ?').bind(id).first<BoxRow>(),
    env.DB.prepare(
      'SELECT id, name, quantity, source FROM items WHERE box_id = ? ORDER BY position',
    )
      .bind(id)
      .all<Item>(),
    env.DB.prepare('SELECT id, created_at FROM photos WHERE box_id = ? ORDER BY created_at')
      .bind(id)
      .all<Photo>(),
  ]);
  return box && { ...box, items: items.results, photos: photos.results };
}

/** The box as returned to a caller that already passed requireHouse/requireBoxAccess, so may edit it. */
async function editableBox(id: string): Promise<Box> {
  const box = await loadBox(id);
  if (!box) {
    throw new HTTPException(404, { message: 'Not found' });
  }
  return { ...box, can_edit: true };
}

const SAFE_IMAGE_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/heic',
  'image/heif',
]);
const HEIC_BRANDS = new Set(['heic', 'heix', 'hevc', 'hevx', 'mif1', 'msf1']);

/** Identify an image by its magic bytes; the client-declared MIME type is never trusted. */
function sniffImage(b: Uint8Array): string | undefined {
  const ascii = (from: number, to: number) => String.fromCharCode(...b.subarray(from, to));
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) {
    return 'image/jpeg';
  }
  if (b[0] === 0x89 && ascii(1, 4) === 'PNG') {
    return 'image/png';
  }
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') {
    return 'image/webp';
  }
  if (ascii(0, 4) === 'GIF8') {
    return 'image/gif';
  }
  if (ascii(4, 8) === 'ftyp' && HEIC_BRANDS.has(ascii(8, 12))) {
    return 'image/heic';
  }
  return undefined;
}

type Upload = { bytes: Uint8Array; type: string };

async function readPhoto(c: Context): Promise<Upload> {
  const form = await c.req.formData().catch(() => undefined);
  const file = form?.get('photo');
  if (!(file instanceof File)) {
    throw new HTTPException(400, { message: 'Missing photo' });
  }
  if (file.size > 15 * 1024 * 1024) {
    throw new HTTPException(413, { message: 'Photo too large' });
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  const type = sniffImage(bytes);
  if (!type) {
    throw new HTTPException(415, { message: 'That file is not a photo' });
  }
  return { bytes, type };
}

/** Stores the photo and asks the AI what is in it, at the same time. A failed extraction is not fatal. */
async function storeAndExtract(
  r2Key: string,
  photo: Upload,
  existingItems?: string[],
): Promise<Extraction | undefined> {
  const extraction = extractContents({
    apiKey: env.OPENAI_API_KEY,
    model: env.OPENAI_MODEL,
    image: photo.bytes,
    mediaType: photo.type,
    existingItems,
  }).catch((error: unknown) => {
    console.error('AI extraction failed', error);
    return undefined;
  });
  await env.PHOTOS.put(r2Key, photo.bytes, { httpMetadata: { contentType: photo.type } });
  return extraction;
}

const insertItem =
  'INSERT INTO items (id, box_id, name, quantity, source, position) VALUES (?, ?, ?, ?, ?, ?)';
const insertPhoto = 'INSERT INTO photos (id, box_id, r2_key, created_at) VALUES (?, ?, ?, ?)';

type NewItem = { name: string; quantity: number | null; source?: Item['source'] };
const itemInserts = (boxId: string, items: NewItem[], startPos: number) =>
  items.map((it, i) =>
    env.DB.prepare(insertItem).bind(
      newRowId(),
      boxId,
      it.name,
      it.quantity,
      it.source ?? 'ai',
      startPos + i,
    ),
  );

// Create a box from a photo.
api.post('/boxes', requireHouse, async (c) => {
  const photo = await readPhoto(c);
  const id = newBoxId();
  const photoId = newRowId();
  const r2Key = `photos/${id}/${photoId}`;
  const extraction = await storeAndExtract(r2Key, photo);
  const now = Date.now();

  await env.DB.batch([
    // An unreadable photo still makes a box: it is titled after the number it was just given.
    env.DB.prepare(
      `INSERT INTO boxes (id, house_id, number, title, room, status, created_at, updated_at)
       SELECT ?1, ?2, n, COALESCE(?3, 'Box ' || n), ?4, 'packed', ?5, ?5
       FROM (SELECT COALESCE(MAX(number), 0) + 1 AS n FROM boxes WHERE house_id = ?2)`,
    ).bind(id, c.var.houseId, extraction?.title || null, extraction?.room ?? null, now),
    env.DB.prepare(insertPhoto).bind(photoId, id, r2Key, now),
    ...itemInserts(id, extraction?.items ?? [], 0),
  ]);
  return c.json({ box: await editableBox(id), aiFailed: !extraction }, 201);
});

// Add another photo; AI appends items it hasn't seen yet.
api.post('/boxes/:id/photos', requireBoxAccess, async (c) => {
  const id = pid(c);
  const [photo, { results: existing }] = await Promise.all([
    readPhoto(c),
    env.DB.prepare('SELECT name FROM items WHERE box_id = ? ORDER BY position')
      .bind(id)
      .all<{ name: string }>(),
  ]);
  const photoId = newRowId();
  const r2Key = `photos/${id}/${photoId}`;
  const extraction = await storeAndExtract(
    r2Key,
    photo,
    existing.map((item) => item.name),
  );
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare(insertPhoto).bind(photoId, id, r2Key, now),
    env.DB.prepare('UPDATE boxes SET updated_at = ? WHERE id = ?').bind(now, id),
    ...itemInserts(id, extraction?.items ?? [], existing.length),
  ]);
  return c.json({ box: await editableBox(id), aiFailed: !extraction });
});

// List / search.
api.get('/boxes', requireHouse, async (c) => {
  const boxes = await searchBoxes(
    env.DB,
    env.OPENAI_API_KEY,
    c.var.houseId,
    c.req.query('q')?.trim() ?? '',
  );
  return c.json({ boxes });
});

// Public: anyone with the (unguessable) link can view a box.
api.get('/boxes/:id', async (c) => {
  const [box, user] = await Promise.all([loadBox(pid(c)), userFromRequest(c)]);
  if (!box) {
    return c.json({ error: 'Not found' }, 404);
  }
  return c.json<{ box: Box }>({
    box: { ...box, can_edit: await canAccessHouse(user, box.house_id) },
  });
});

const blankAsNull = (text: string | null) => text?.trim() || null;
const boxPatch = z
  .object({
    title: z.string().transform((title) => title.trim().slice(0, TITLE_MAX * 2)),
    room: z.string().nullable().transform(blankAsNull),
    notes: z.string().nullable().transform(blankAsNull),
    status: z.enum(['packed', 'unpacked'] satisfies BoxStatus[]),
  })
  .partial();

api.patch('/boxes/:id', requireBoxAccess, async (c) => {
  const id = pid(c);
  // Column names come from the schema's own keys, never from the request.
  const changes = Object.entries(await body(c, boxPatch));
  if (changes.length === 0) {
    return c.json({ error: 'Nothing to update' }, 400);
  }
  const sets = [...changes.map(([column]) => `${column} = ?`), 'updated_at = ?'];
  const values = [...changes.map(([, value]) => value), Date.now()];
  await env.DB.prepare(`UPDATE boxes SET ${sets.join(', ')} WHERE id = ?`)
    .bind(...values, id)
    .run();
  return c.json({ box: await editableBox(id) });
});

const itemList = z.object({
  items: z.array(
    z.object({
      name: z.string().trim(),
      quantity: z.int().nullable().default(null),
      source: z.enum(['ai', 'manual']).default('manual'),
    }),
  ),
  /** The box version the editor started from. */
  if_updated_at: z.number().optional(),
});

// Replace the item list.
api.put('/boxes/:id/items', requireBoxAccess, async (c) => {
  const id = pid(c);
  const { items, if_updated_at: expected } = await body(c, itemList);
  // Optimistic concurrency: bumping the version is also the check that nobody else changed the box,
  // so two editors saving at once cannot both win.
  const claimed = await env.DB.prepare(
    'UPDATE boxes SET updated_at = ?1 WHERE id = ?2 AND (?3 IS NULL OR updated_at = ?3)',
  )
    .bind(Date.now(), id, expected ?? null)
    .run();
  if (!claimed.meta.changes) {
    return c.json(
      { error: 'This box was changed by someone else. Reload to see the latest list.' },
      409,
    );
  }
  await env.DB.batch([
    env.DB.prepare('DELETE FROM items WHERE box_id = ?').bind(id),
    ...itemInserts(
      id,
      items.filter((item) => item.name),
      0,
    ),
  ]);
  return c.json({ box: await editableBox(id) });
});

api.delete('/boxes/:id', requireBoxAccess, async (c) => {
  const id = pid(c);
  const { results } = await env.DB.prepare('SELECT r2_key FROM photos WHERE box_id = ?')
    .bind(id)
    .all<{ r2_key: string }>();
  if (results.length > 0) {
    await env.PHOTOS.delete(results.map((r) => r.r2_key));
  }
  await env.DB.batch([
    env.DB.prepare('DELETE FROM items WHERE box_id = ?').bind(id),
    env.DB.prepare('DELETE FROM photos WHERE box_id = ?').bind(id),
    env.DB.prepare('DELETE FROM boxes WHERE id = ?').bind(id),
  ]);
  return c.json({ ok: true });
});

// Public: photo IDs are random, only discoverable via a box link.
api.get('/photos/:id', async (c) => {
  const r2Key = await env.DB.prepare('SELECT r2_key FROM photos WHERE id = ?')
    .bind(pid(c))
    .first<string>('r2_key');
  const obj = r2Key ? await env.PHOTOS.get(r2Key) : null;
  if (!obj) {
    return c.json({ error: 'Not found' }, 404);
  }
  const stored = obj.httpMetadata?.contentType ?? '';
  return new Response(obj.body, {
    headers: {
      // Never serve anything that a browser could execute on this origin (older uploads included).
      'content-type': SAFE_IMAGE_TYPES.has(stored) ? stored : 'application/octet-stream',
      'x-content-type-options': 'nosniff',
      'content-security-policy':
        "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
      'content-disposition': 'inline',
      'cache-control': 'public, max-age=31536000, immutable',
    },
  });
});

app.use('/api/*', async (c, next) => {
  // Native app calls the API cross-origin in dev; allow it.
  await next();
  c.res.headers.set('access-control-allow-origin', '*');
});
app.options('/api/*', (c) =>
  c.body(null, 204, {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
    'access-control-allow-headers': 'content-type,x-house-id,authorization',
  }),
);
api.route('/', houseRoutes);
api.route('/', printingRoutes);
app.route('/', authRoutes);
app.route('/api', api);
app.get('*', async (c) => (await serveWebFallback(c.req.raw, env.ASSETS)) ?? c.notFound());
app.onError((error, c) => {
  if (error instanceof HTTPException) {
    return c.json({ error: error.message }, error.status);
  }
  console.error(error);
  return c.json({ error: 'Server error' }, 500);
});

export default app satisfies ExportedHandler;
