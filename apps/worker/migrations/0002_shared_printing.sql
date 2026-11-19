-- Household printer sharing: any device with the D30 connected advertises itself here,
-- and devices without one (e.g. an iPhone, which has no Web Bluetooth) queue jobs for it.

-- Connection status: one row per device that currently has a printer connected.
-- A row is "online" while last_seen is recent; hosts heartbeat every few seconds.
CREATE TABLE printer_connections (
  device_id TEXT PRIMARY KEY,
  device_name TEXT NOT NULL,
  printer_name TEXT,
  last_seen INTEGER NOT NULL
);

-- Relayed print jobs. `label` is the LabelInput JSON; the host renders and encodes it itself.
CREATE TABLE print_jobs (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  requested_by TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'printing', 'done', 'failed')),
  claimed_by TEXT,
  error TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX print_jobs_status ON print_jobs(status, created_at);
