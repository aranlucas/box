import { env } from "cloudflare:workers";
import { Hono, type Context, type Next } from "hono";
import { extractContents, TITLE_MAX, type Extraction } from "./ai.ts";
import { authRoutes } from "./auth/routes.ts";
import { actorFrom, canAccessHouse, HOME_ID, houseRoutes } from "./houses.ts";

type Box = {
  id: string;
  house_id: string;
  number: number;
  title: string;
  room: string | null;
  notes: string | null;
  status: "packed" | "unpacked";
  created_at: number;
  updated_at: number;
};
type Item = { id: string; name: string; quantity: number | null; source: "ai" | "manual"; position: number };
type Photo = { id: string; created_at: number };

// Crockford base32 (no I, L, O, U): uppercase-only so it survives QR alphanumeric mode.
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
function randomId(len: number): string {
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  return Array.from(bytes, (b) => ALPHABET[b & 31]).join("");
}
const boxId = () => randomId(8); // 40 bits
const rowId = () => randomId(16);

const pid = (c: Context) => (c.req.param("id") ?? "").toUpperCase();

const app = new Hono();

// QR codes encode the URL uppercased (denser QR). Normalise /B/XXXX → /b/XXXX for the SPA router.
app.get("/B/:id", (c) => c.redirect(`/b/${pid(c)}`, 301));

type Env = { Variables: { houseId: string } };
const api = new Hono<Env>();

/** List/create: the caller must belong to the house named by x-house-id (legacy key → Home). */
async function requireHouse(c: Context<Env>, next: Next) {
  const actor = await actorFrom(c);
  if (!actor.user && !actor.legacy) return c.json({ error: "Sign in required" }, 401);
  const houseId = c.req.header("x-house-id") || (actor.legacy ? HOME_ID : "");
  if (!houseId) return c.json({ error: "Choose a house" }, 400);
  if (!(await canAccessHouse(actor, houseId))) return c.json({ error: "Not a member of this house" }, 403);
  c.set("houseId", houseId);
  await next();
}

/** Box-by-id: the caller must belong to the box's own house. */
async function requireBoxAccess(c: Context<Env>, next: Next) {
  const box = await env.DB.prepare("SELECT house_id FROM boxes WHERE id = ?").bind(pid(c)).first<{ house_id: string }>();
  if (!box) return c.json({ error: "Not found" }, 404);
  const actor = await actorFrom(c);
  if (!actor.user && !actor.legacy) return c.json({ error: "Sign in required" }, 401);
  if (!(await canAccessHouse(actor, box.house_id))) return c.json({ error: "Not a member of this house" }, 403);
  c.set("houseId", box.house_id);
  await next();
}

// Legacy (v1.0.0 setup screen): true while the household key is still accepted.
api.get("/auth/check", async (c) => ((await actorFrom(c)).legacy ? c.json({ ok: true }) : c.json({ error: "Invalid key" }, 401)));

// Responses from routes that already passed requireHouse/requireBoxAccess are editable by the caller.
const editable = <T extends object>(box: T | null) => (box ? { ...box, can_edit: true } : box);

async function loadBox(id: string) {
  const box = await env.DB.prepare("SELECT * FROM boxes WHERE id = ?").bind(id.toUpperCase()).first<Box>();
  if (!box) return null;
  const [items, photos] = await env.DB.batch([
    env.DB.prepare("SELECT id, name, quantity, source, position FROM items WHERE box_id = ? ORDER BY position").bind(box.id),
    env.DB.prepare("SELECT id, created_at FROM photos WHERE box_id = ? ORDER BY created_at").bind(box.id),
  ]);
  return { ...box, items: items.results as Item[], photos: photos.results as Photo[] };
}

async function readPhoto(c: Context): Promise<{ bytes: Uint8Array; type: string } | Response> {
  const form = await c.req.formData().catch(() => null);
  const file = form?.get("photo");
  if (!file || typeof file === "string") return c.json({ error: "Missing photo" }, 400);
  if (file.size > 15 * 1024 * 1024) return c.json({ error: "Photo too large" }, 413);
  return { bytes: new Uint8Array(await file.arrayBuffer()), type: file.type || "image/jpeg" };
}

async function tryExtract(photo: { bytes: Uint8Array; type: string }, existingItems?: string[]) {
  try {
    return await extractContents({
      apiKey: env.OPENAI_API_KEY,
      model: env.OPENAI_MODEL,
      image: photo.bytes,
      mediaType: photo.type,
      existingItems,
    });
  } catch (err) {
    console.error("AI extraction failed", err);
    return null;
  }
}

function itemInserts(id: string, items: Extraction["items"], startPos: number, source: "ai" | "manual") {
  return items.map((it, i) =>
    env.DB.prepare("INSERT INTO items (id, box_id, name, quantity, source, position) VALUES (?, ?, ?, ?, ?, ?)").bind(
      rowId(),
      id,
      it.name,
      it.quantity ?? null,
      source,
      startPos + i,
    ),
  );
}

// Create a box from a photo.
api.post("/boxes", requireHouse, async (c) => {
  const houseId = c.get("houseId");
  const photo = await readPhoto(c);
  if (photo instanceof Response) return photo;

  const id = boxId();
  const photoId = rowId();
  const now = Date.now();
  const r2Key = `photos/${id}/${photoId}`;

  const [, extraction] = await Promise.all([
    env.PHOTOS.put(r2Key, photo.bytes, { httpMetadata: { contentType: photo.type } }),
    tryExtract(photo),
  ]);

  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO boxes (id, house_id, number, title, room, status, created_at, updated_at)
       VALUES (?1, ?2, (SELECT COALESCE(MAX(number), 0) + 1 FROM boxes WHERE house_id = ?2), ?3, ?4, 'packed', ?5, ?5)`,
    ).bind(id, houseId, extraction?.title || "", extraction?.room ?? null, now),
    env.DB.prepare("INSERT INTO photos (id, box_id, r2_key, created_at) VALUES (?, ?, ?, ?)").bind(photoId, id, r2Key, now),
    ...itemInserts(id, extraction?.items ?? [], 0, "ai"),
  ]);

  const box = await loadBox(id);
  if (box && !box.title) {
    box.title = `Box ${box.number}`;
    await env.DB.prepare("UPDATE boxes SET title = ? WHERE id = ?").bind(box.title, id).run();
  }
  return c.json({ box: editable(box), aiFailed: extraction === null }, 201);
});

// Add another photo; AI appends items it hasn't seen yet.
api.post("/boxes/:id/photos", requireBoxAccess, async (c) => {
  const box = await loadBox(pid(c));
  if (!box) return c.json({ error: "Not found" }, 404);
  const photo = await readPhoto(c);
  if (photo instanceof Response) return photo;

  const photoId = rowId();
  const r2Key = `photos/${box.id}/${photoId}`;
  const [, extraction] = await Promise.all([
    env.PHOTOS.put(r2Key, photo.bytes, { httpMetadata: { contentType: photo.type } }),
    tryExtract(photo, box.items.map((i) => i.name)),
  ]);
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare("INSERT INTO photos (id, box_id, r2_key, created_at) VALUES (?, ?, ?, ?)").bind(photoId, box.id, r2Key, now),
    env.DB.prepare("UPDATE boxes SET updated_at = ? WHERE id = ?").bind(now, box.id),
    ...itemInserts(box.id, extraction?.items ?? [], box.items.length, "ai"),
  ]);
  return c.json({ box: editable(await loadBox(box.id)), aiFailed: extraction === null });
});

// List / search.
api.get("/boxes", requireHouse, async (c) => {
  const houseId = c.get("houseId");
  const q = c.req.query("q")?.trim();
  const base = `SELECT b.*, (SELECT COUNT(*) FROM items i WHERE i.box_id = b.id) AS item_count,
    (SELECT group_concat(name, ', ') FROM (SELECT name FROM items i WHERE i.box_id = b.id ORDER BY position LIMIT 6)) AS preview
    FROM boxes b`;
  const stmt = q
    ? env.DB.prepare(
        `${base} WHERE b.house_id = ?3 AND (b.title LIKE ?1 OR b.room LIKE ?1 OR b.notes LIKE ?1 OR CAST(b.number AS TEXT) = ?2
         OR EXISTS (SELECT 1 FROM items i WHERE i.box_id = b.id AND i.name LIKE ?1))
         ORDER BY b.number DESC`,
      ).bind(`%${q}%`, q.replace(/^#/, ""), houseId)
    : env.DB.prepare(`${base} WHERE b.house_id = ?1 ORDER BY b.number DESC`).bind(houseId);
  const { results } = await stmt.all();
  return c.json({ boxes: results });
});

// Public: anyone with the (unguessable) link can view a box.
api.get("/boxes/:id", async (c) => {
  const box = await loadBox(pid(c));
  if (!box) return c.json({ error: "Not found" }, 404);
  const can_edit = await canAccessHouse(await actorFrom(c), box.house_id);
  return c.json({ box: { ...box, can_edit } });
});

api.patch("/boxes/:id", requireBoxAccess, async (c) => {
  const id = pid(c);
  const body = await c.req.json<Partial<Pick<Box, "title" | "room" | "notes" | "status">>>();
  const sets: string[] = [];
  const vals: unknown[] = [];
  if (typeof body.title === "string") (sets.push("title = ?"), vals.push(body.title.trim().slice(0, TITLE_MAX * 2)));
  if (body.room !== undefined) (sets.push("room = ?"), vals.push(body.room?.trim() || null));
  if (body.notes !== undefined) (sets.push("notes = ?"), vals.push(body.notes?.trim() || null));
  if (body.status === "packed" || body.status === "unpacked") (sets.push("status = ?"), vals.push(body.status));
  if (!sets.length) return c.json({ error: "Nothing to update" }, 400);
  sets.push("updated_at = ?");
  vals.push(Date.now());
  const res = await env.DB.prepare(`UPDATE boxes SET ${sets.join(", ")} WHERE id = ?`).bind(...vals, id).run();
  if (!res.meta.changes) return c.json({ error: "Not found" }, 404);
  return c.json({ box: editable(await loadBox(id)) });
});

// Replace the item list (simple; edits come from one household).
api.put("/boxes/:id/items", requireBoxAccess, async (c) => {
  const id = pid(c);
  const exists = await env.DB.prepare("SELECT id FROM boxes WHERE id = ?").bind(id).first();
  if (!exists) return c.json({ error: "Not found" }, 404);
  const body = await c.req.json<{ items: { name: string; quantity?: number | null; source?: "ai" | "manual" }[] }>();
  const items = (body.items ?? []).filter((i) => i.name?.trim());
  await env.DB.batch([
    env.DB.prepare("DELETE FROM items WHERE box_id = ?").bind(id),
    ...items.map((it, i) =>
      env.DB.prepare("INSERT INTO items (id, box_id, name, quantity, source, position) VALUES (?, ?, ?, ?, ?, ?)").bind(
        rowId(),
        id,
        it.name.trim(),
        Number.isInteger(it.quantity) ? it.quantity : null,
        it.source === "ai" ? "ai" : "manual",
        i,
      ),
    ),
    env.DB.prepare("UPDATE boxes SET updated_at = ? WHERE id = ?").bind(Date.now(), id),
  ]);
  return c.json({ box: editable(await loadBox(id)) });
});

api.delete("/boxes/:id", requireBoxAccess, async (c) => {
  const id = pid(c);
  const { results } = await env.DB.prepare("SELECT r2_key FROM photos WHERE box_id = ?").bind(id).all<{ r2_key: string }>();
  if (results.length) await env.PHOTOS.delete(results.map((r) => r.r2_key));
  await env.DB.batch([
    env.DB.prepare("DELETE FROM items WHERE box_id = ?").bind(id),
    env.DB.prepare("DELETE FROM photos WHERE box_id = ?").bind(id),
    env.DB.prepare("DELETE FROM boxes WHERE id = ?").bind(id),
  ]);
  return c.json({ ok: true });
});

// Public: photo IDs are random, only discoverable via a box link.
api.get("/photos/:id", async (c) => {
  const row = await env.DB.prepare("SELECT r2_key FROM photos WHERE id = ?").bind(pid(c)).first<{ r2_key: string }>();
  if (!row) return c.json({ error: "Not found" }, 404);
  const obj = await env.PHOTOS.get(row.r2_key);
  if (!obj) return c.json({ error: "Not found" }, 404);
  return new Response(obj.body, {
    headers: {
      "content-type": obj.httpMetadata?.contentType ?? "image/jpeg",
      "cache-control": "public, max-age=31536000, immutable",
    },
  });
});

app.use("/api/*", async (c, next) => {
  // Native app calls the API cross-origin in dev; allow it.
  await next();
  c.res.headers.set("access-control-allow-origin", "*");
});
app.options("/api/*", (c) =>
  c.body(null, 204, {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
    "access-control-allow-headers": "content-type,x-household-key,x-house-id,authorization",
  }),
);
api.route("/", houseRoutes);
app.route("/", authRoutes);
app.route("/api", api);
app.onError((err, c) => {
  console.error(err);
  return c.json({ error: "Server error" }, 500);
});

export default app satisfies ExportedHandler;
