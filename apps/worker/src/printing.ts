// Shared printing within a house.
//
// A device with the D30 connected ("host") heartbeats POST /printers/heartbeat every couple of
// seconds; that keeps its row in `printer_connections` fresh and returns any queued jobs. Another
// member's device without a printer (an iPhone, say) queues a job with POST /print-jobs and polls
// it until the host claims, prints and completes it. Everything is plain D1: no sockets, no cron.
//
// Every route runs behind requireHouse (x-house-id), and every query is scoped to that house.
import type { HouseholdPrinter, PrintJob, PrintJobStatus, QueuedJob } from '@mj/api';
import type { LabelInput } from '@mj/label';
import { env } from 'cloudflare:workers';
import { Hono } from 'hono';
import { z } from 'zod';
import { requireHouse, type HouseEnv } from './houses.ts';
import { body } from './util.ts';

/** A host is online if it heartbeated within this window. */
export const ONLINE_MS = 15_000;
/** A queued job nobody claimed within this window is abandoned (so a host coming back later never prints stale labels). */
const QUEUE_TTL_MS = 25_000;
/** A claimed job that never completed within this window has failed. */
const PRINT_TTL_MS = 60_000;
/** Heartbeats only rewrite the row when it's at least this stale (keeps D1 writes low). */
const HEARTBEAT_WRITE_MS = 5000;
const DAY_MS = 86_400_000;

const deviceId = z.string('Missing deviceId').trim().min(1, 'Missing deviceId').max(64);
const name = z.string().trim().min(1).max(80);
const label = z.object(
  { number: z.int(), title: z.string().max(200), url: z.string().trim().min(1).max(300) },
  'Missing label',
) satisfies z.ZodType<LabelInput>;

const heartbeat = z.object({
  deviceId,
  deviceName: name.catch('Unnamed device'),
  printerName: name.nullable().catch(null),
});
const printRequest = z.object({ deviceId, label });
const host = z.object({ deviceId });
const outcome = z.object({
  deviceId,
  ok: z.boolean().catch(false),
  error: z.string().trim().min(1).max(300).catch('Printing failed'),
});

type JobRow = { id: string; label: string; requested_by: string; created_at: number };
type JobState = {
  id: string;
  status: PrintJobStatus;
  error: string | null;
  created_at: number;
  updated_at: number;
  via: string | null;
};

export const printingRoutes = new Hono<HouseEnv>();

/** The connection status table: every device in this house that can print right now. */
printingRoutes.get('/printers', requireHouse, async (c) => {
  const { results } = await env.DB.prepare(
    `SELECT device_id, device_name, printer_name FROM printer_connections
     WHERE house_id = ? AND last_seen > ? ORDER BY last_seen DESC`,
  )
    .bind(c.var.houseId, Date.now() - ONLINE_MS)
    .all<HouseholdPrinter>();
  return c.json({ printers: results });
});

/** Host heartbeat: "I'm here with a printer". Returns this house's jobs waiting to be printed. */
printingRoutes.post('/printers/heartbeat', requireHouse, async (c) => {
  const device = await body(c, heartbeat);
  const { houseId } = c.var;
  const now = Date.now();

  const [, jobs] = await Promise.all([
    env.DB.prepare(
      `INSERT INTO printer_connections (house_id, device_id, device_name, printer_name, last_seen) VALUES (?1, ?2, ?3, ?4, ?5)
       ON CONFLICT(house_id, device_id) DO UPDATE SET device_name = excluded.device_name, printer_name = excluded.printer_name, last_seen = excluded.last_seen
       WHERE last_seen < ?6 OR device_name IS NOT excluded.device_name OR printer_name IS NOT excluded.printer_name`,
    )
      .bind(
        houseId,
        device.deviceId,
        device.deviceName,
        device.printerName,
        now,
        now - HEARTBEAT_WRITE_MS,
      )
      .run(),
    env.DB.prepare(
      `SELECT id, label, requested_by, created_at FROM print_jobs
       WHERE house_id = ? AND status = 'queued' AND created_at > ? ORDER BY created_at LIMIT 5`,
    )
      .bind(houseId, now - QUEUE_TTL_MS)
      .all<JobRow>(),
  ]);
  const queued = jobs.results.map((job): QueuedJob => ({
    id: job.id,
    label: label.parse(JSON.parse(job.label)),
    requestedBy: job.requested_by,
    createdAt: job.created_at,
  }));
  return c.json({ jobs: queued });
});

/** Host went away (printer disconnected or app backgrounded). */
printingRoutes.delete('/printers/:deviceId', requireHouse, async (c) => {
  await env.DB.prepare('DELETE FROM printer_connections WHERE house_id = ? AND device_id = ?')
    .bind(c.var.houseId, c.req.param('deviceId'))
    .run();
  return c.json({ ok: true });
});

/** Queue a label for whichever device in this house has a printer. */
printingRoutes.post('/print-jobs', requireHouse, async (c) => {
  const request = await body(c, printRequest);
  const { houseId } = c.var;
  const now = Date.now();

  const via = await env.DB.prepare(
    `SELECT device_name FROM printer_connections
     WHERE house_id = ? AND last_seen > ? AND device_id != ? ORDER BY last_seen DESC LIMIT 1`,
  )
    .bind(houseId, now - ONLINE_MS, request.deviceId)
    .first<string>('device_name');
  if (!via) {
    return c.json({ error: 'No printer is connected in this house right now.' }, 409);
  }

  const id = crypto.randomUUID();
  await env.DB.batch([
    env.DB.prepare('DELETE FROM print_jobs WHERE created_at < ?').bind(now - DAY_MS),
    env.DB.prepare('DELETE FROM printer_connections WHERE last_seen < ?').bind(now - DAY_MS),
    env.DB.prepare(
      "INSERT INTO print_jobs (id, house_id, label, requested_by, status, created_at, updated_at) VALUES (?, ?, ?, ?, 'queued', ?, ?)",
    ).bind(id, houseId, JSON.stringify(request.label), request.deviceId, now, now),
  ]);
  return c.json<{ job: PrintJob }>({ job: { id, status: 'queued', error: null, via } }, 201);
});

/** Why a job that is still open has to be given up on; expiry is computed on read, so there is no cron. */
function expiry(job: JobState, now: number): string | undefined {
  if (job.status === 'queued' && job.created_at < now - QUEUE_TTL_MS) {
    return 'No printer picked up the label. Is the app still open on the phone with the printer?';
  }
  if (job.status === 'printing' && job.updated_at < now - PRINT_TTL_MS) {
    return 'The printer stopped responding.';
  }
  return undefined;
}

/** Poll a job. */
printingRoutes.get('/print-jobs/:id', requireHouse, async (c) => {
  const job = await env.DB.prepare(
    `SELECT j.id, j.status, j.error, j.created_at, j.updated_at, p.device_name AS via FROM print_jobs j
     LEFT JOIN printer_connections p ON p.house_id = j.house_id AND p.device_id = j.claimed_by
     WHERE j.id = ? AND j.house_id = ?`,
  )
    .bind(c.req.param('id'), c.var.houseId)
    .first<JobState>();
  if (!job) {
    return c.json({ error: 'Not found' }, 404);
  }
  const { id, via } = job;
  const expired = expiry(job, Date.now());
  return c.json<{ job: PrintJob }>({
    job: expired
      ? { id, via, status: 'failed', error: expired }
      : { id, via, status: job.status, error: job.error },
  });
});

/** Host claims a job before printing. Atomic, so two hosts never print the same label. */
printingRoutes.post('/print-jobs/:id/claim', requireHouse, async (c) => {
  const claimant = await body(c, host);
  const now = Date.now();
  const res = await env.DB.prepare(
    `UPDATE print_jobs SET status = 'printing', claimed_by = ?, updated_at = ?
     WHERE id = ? AND house_id = ? AND status = 'queued' AND created_at > ?`,
  )
    .bind(claimant.deviceId, now, c.req.param('id'), c.var.houseId, now - QUEUE_TTL_MS)
    .run();
  return res.meta.changes
    ? c.json({ ok: true })
    : c.json({ error: 'Job already taken or expired' }, 409);
});

/** Host reports the outcome. */
printingRoutes.post('/print-jobs/:id/complete', requireHouse, async (c) => {
  const result = await body(c, outcome);
  await env.DB.prepare(
    `UPDATE print_jobs SET status = ?, error = ?, updated_at = ?
     WHERE id = ? AND house_id = ? AND claimed_by = ? AND status = 'printing'`,
  )
    .bind(
      result.ok ? 'done' : 'failed',
      result.ok ? null : result.error,
      Date.now(),
      c.req.param('id'),
      c.var.houseId,
      result.deviceId,
    )
    .run();
  return c.json({ ok: true });
});
