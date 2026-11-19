// Household printer sharing.
//
// A device with the D30 connected ("host") heartbeats POST /printers/heartbeat every couple of
// seconds; that keeps its row in `printer_connections` fresh and returns any queued jobs. A device
// without a printer (an iPhone, say) queues a job with POST /print-jobs and polls it until the
// host claims, prints and completes it. Everything is plain D1: no sockets, no cron.
import { env } from "cloudflare:workers";
import { Hono } from "hono";
import { requireKey } from "./auth.ts";

/** A host is online if it heartbeated within this window. */
export const ONLINE_MS = 15_000;
/** A queued job nobody claimed within this window is abandoned (so a host coming back later never prints stale labels). */
const QUEUE_TTL_MS = 25_000;
/** A claimed job that never completed within this window has failed. */
const PRINT_TTL_MS = 60_000;
/** Heartbeats only rewrite the row when it's at least this stale (keeps D1 writes low). */
const HEARTBEAT_WRITE_MS = 5_000;
const DAY_MS = 86_400_000;

type Label = { number: number; title: string; url: string };
type Job = {
  id: string;
  label: string;
  requested_by: string;
  status: "queued" | "printing" | "done" | "failed";
  claimed_by: string | null;
  error: string | null;
  created_at: number;
  updated_at: number;
};

const str = (v: unknown, max: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);

function parseLabel(v: unknown): Label | null {
  if (!v || typeof v !== "object") return null;
  const l = v as Record<string, unknown>;
  const title = typeof l.title === "string" ? l.title.slice(0, 200) : null;
  const url = str(l.url, 300);
  if (!Number.isInteger(l.number) || title === null || !url) return null;
  return { number: l.number as number, title, url };
}

const printing = new Hono();

/** The connection status table: every device in the household that can print right now. */
printing.get("/printers", requireKey, async (c) => {
  const { results } = await env.DB.prepare(
    "SELECT device_id, device_name, printer_name, last_seen FROM printer_connections WHERE last_seen > ? ORDER BY last_seen DESC",
  )
    .bind(Date.now() - ONLINE_MS)
    .all();
  return c.json({ printers: results });
});

/** Host heartbeat: "I'm here with a printer". Returns jobs waiting to be printed. */
printing.post("/printers/heartbeat", requireKey, async (c) => {
  const body = await c.req.json<Record<string, unknown>>().catch(() => ({}) as Record<string, unknown>);
  const deviceId = str(body.deviceId, 64);
  if (!deviceId) return c.json({ error: "Missing deviceId" }, 400);
  const deviceName = str(body.deviceName, 80) ?? "Unnamed device";
  const printerName = str(body.printerName, 80);
  const now = Date.now();

  const [, jobs] = await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO printer_connections (device_id, device_name, printer_name, last_seen) VALUES (?1, ?2, ?3, ?4)
       ON CONFLICT(device_id) DO UPDATE SET device_name = excluded.device_name, printer_name = excluded.printer_name, last_seen = excluded.last_seen
       WHERE last_seen < ?5 OR device_name IS NOT excluded.device_name OR printer_name IS NOT excluded.printer_name`,
    ).bind(deviceId, deviceName, printerName, now, now - HEARTBEAT_WRITE_MS),
    env.DB.prepare(
      "SELECT id, label, requested_by, created_at FROM print_jobs WHERE status = 'queued' AND created_at > ? ORDER BY created_at LIMIT 5",
    ).bind(now - QUEUE_TTL_MS),
  ]);
  const queued = (jobs.results as Pick<Job, "id" | "label" | "requested_by" | "created_at">[]).map((j) => ({
    id: j.id,
    label: JSON.parse(j.label) as Label,
    requestedBy: j.requested_by,
    createdAt: j.created_at,
  }));
  return c.json({ jobs: queued });
});

/** Host went away (printer disconnected or app backgrounded). */
printing.delete("/printers/:deviceId", requireKey, async (c) => {
  await env.DB.prepare("DELETE FROM printer_connections WHERE device_id = ?").bind(c.req.param("deviceId")).run();
  return c.json({ ok: true });
});

/** Queue a label for whichever household device has a printer. */
printing.post("/print-jobs", requireKey, async (c) => {
  const body = await c.req.json<Record<string, unknown>>().catch(() => ({}) as Record<string, unknown>);
  const label = parseLabel(body.label);
  const deviceId = str(body.deviceId, 64);
  if (!label || !deviceId) return c.json({ error: "Missing label or deviceId" }, 400);
  const now = Date.now();

  const host = await env.DB.prepare(
    "SELECT device_name FROM printer_connections WHERE last_seen > ? AND device_id != ? ORDER BY last_seen DESC LIMIT 1",
  )
    .bind(now - ONLINE_MS, deviceId)
    .first<{ device_name: string }>();
  if (!host) return c.json({ error: "No printer is connected in your household right now." }, 409);

  const id = crypto.randomUUID();
  await env.DB.batch([
    env.DB.prepare("DELETE FROM print_jobs WHERE created_at < ?").bind(now - DAY_MS),
    env.DB.prepare("DELETE FROM printer_connections WHERE last_seen < ?").bind(now - DAY_MS),
    env.DB.prepare(
      "INSERT INTO print_jobs (id, label, requested_by, status, created_at, updated_at) VALUES (?, ?, ?, 'queued', ?, ?)",
    ).bind(id, JSON.stringify(label), deviceId, now, now),
  ]);
  return c.json({ job: { id, status: "queued", via: host.device_name } }, 201);
});

/** Poll a job. Expiry is computed here, so abandoned jobs resolve without a cron. */
printing.get("/print-jobs/:id", requireKey, async (c) => {
  const job = await env.DB.prepare(
    `SELECT j.*, p.device_name AS claimed_by_name FROM print_jobs j
     LEFT JOIN printer_connections p ON p.device_id = j.claimed_by WHERE j.id = ?`,
  )
    .bind(c.req.param("id"))
    .first<Job & { claimed_by_name: string | null }>();
  if (!job) return c.json({ error: "Not found" }, 404);
  const now = Date.now();
  let { status, error } = job;
  if (status === "queued" && job.created_at < now - QUEUE_TTL_MS) {
    status = "failed";
    error = "No printer picked up the label. Is the app still open on the phone with the printer?";
  } else if (status === "printing" && job.updated_at < now - PRINT_TTL_MS) {
    status = "failed";
    error = "The printer stopped responding.";
  }
  return c.json({ job: { id: job.id, status, error, via: job.claimed_by_name } });
});

/** Host claims a job before printing. Atomic, so two hosts never print the same label. */
printing.post("/print-jobs/:id/claim", requireKey, async (c) => {
  const body = await c.req.json<Record<string, unknown>>().catch(() => ({}) as Record<string, unknown>);
  const deviceId = str(body.deviceId, 64);
  if (!deviceId) return c.json({ error: "Missing deviceId" }, 400);
  const now = Date.now();
  const res = await env.DB.prepare(
    "UPDATE print_jobs SET status = 'printing', claimed_by = ?, updated_at = ? WHERE id = ? AND status = 'queued' AND created_at > ?",
  )
    .bind(deviceId, now, c.req.param("id"), now - QUEUE_TTL_MS)
    .run();
  return res.meta.changes ? c.json({ ok: true }) : c.json({ error: "Job already taken or expired" }, 409);
});

/** Host reports the outcome. */
printing.post("/print-jobs/:id/complete", requireKey, async (c) => {
  const body = await c.req.json<Record<string, unknown>>().catch(() => ({}) as Record<string, unknown>);
  const deviceId = str(body.deviceId, 64);
  if (!deviceId) return c.json({ error: "Missing deviceId" }, 400);
  const ok = body.ok === true;
  await env.DB.prepare(
    "UPDATE print_jobs SET status = ?, error = ?, updated_at = ? WHERE id = ? AND claimed_by = ? AND status = 'printing'",
  )
    .bind(ok ? "done" : "failed", ok ? null : (str(body.error, 300) ?? "Printing failed"), Date.now(), c.req.param("id"), deviceId)
    .run();
  return c.json({ ok: true });
});

export { printing };
