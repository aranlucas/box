// Shared printing within a house: print from any member's device through whichever device in the
// house has the D30 connected. Works on every platform (it's just HTTP), so an iPhone — which has
// no Web Bluetooth — can print through an Android phone or a Chrome tab that's connected.
//
// - Host: while this device's printer is connected and the app is in the foreground, heartbeat
//   the Worker every couple of seconds. The heartbeat keeps our row in the connection status table
//   fresh and returns queued jobs, which we claim, print and complete.
// - Requester: poll the table so the UI can say "Print via <device>", queue a job and wait for it.
//
// Both polls are React Query queries, so they pause while the app is in the background.
import { focusManager, skipToken, useQuery } from '@tanstack/react-query';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { useSyncExternalStore } from 'react';

import type { LabelInput } from '@mj/label';

import { api, type HouseholdPrinter, type QueuedJob } from './api';
import { deviceName, getDeviceId } from './device';
import { getPrinterState, printLabel, usePrinter } from './printer';
import { PRINTERS_POLL_MS, queries } from './queries';
import { queryClient } from './query';
import { isReady } from './store';
import { errorMessage, sleep } from './util';

const HEARTBEAT_MS = 2000;
const JOB_POLL_MS = 1000;
const JOB_TIMEOUT_MS = 45_000;
const KEEP_AWAKE_TAG = 'household-printer';
const HEARTBEAT_KEY = 'printer-heartbeat';

// One print at a time on this device, so a relayed job and a local tap never interleave chunks.
let printQueue: Promise<unknown> = Promise.resolve();
function serialized<T>(fn: () => Promise<T>): Promise<T> {
  const run = printQueue.then(fn, fn);
  printQueue = run.catch(() => {});
  return run;
}

const isRemote = (deviceId: string | undefined) => (printer: HouseholdPrinter) =>
  printer.device_id !== deviceId;

/** Printers on *other* devices in the house, most recently seen first. Polled while a screen shows them. */
export function useRemotePrinters(houseId: string): HouseholdPrinter[] {
  const deviceId = useQuery(queries.deviceId()).data;
  const printers = useQuery(queries.printers(houseId)).data ?? [];
  return printers.filter(isRemote(deviceId));
}

/** Print a job relayed from another device. Never scans or opens a picker: only prints if already connected. */
async function serve(houseId: string, job: QueuedJob, deviceId: string) {
  // Busy or gone: leave it for another host, or to expire.
  if (getPrinterState().status !== 'connected') {
    return;
  }
  try {
    await api.claimPrintJob(houseId, job.id, deviceId);
  } catch {
    return; // another device took it, or it expired
  }
  const result = await serialized(() =>
    printLabel(job.label, { connect: false, checkMedia: true }),
  ).then(
    () => ({ ok: true }),
    (error: unknown) => ({ ok: false, error: errorMessage(error) }),
  );
  await api.completePrintJob(houseId, job.id, deviceId, result).catch(() => {});
}

/** One heartbeat: tell the house this device can print, and print whatever it has queued for us. */
async function heartbeat(houseId: string) {
  const deviceId = await getDeviceId();
  const jobs = await api.printerHeartbeat(houseId, {
    deviceId,
    deviceName: deviceName(),
    printerName: getPrinterState().name,
  });
  for (const job of jobs) {
    // oxlint-disable-next-line no-await-in-loop -- one printer: labels print one after another
    await serve(houseId, job, deviceId);
  }
  return jobs.length;
}

/**
 * Offers this device's printer to the house for as long as it is connected and the app is in the
 * foreground. Mounted once, at the root: BLE background mode is off and timers get throttled, so
 * a backgrounded app stops advertising and resumes when it comes back.
 */
export function useSharePrinter(houseId: string | undefined) {
  const focused = useSyncExternalStore(
    (onChange) => focusManager.subscribe(onChange),
    () => focusManager.isFocused(),
    () => true,
  );
  const ready = isReady(usePrinter().status);
  const hosting = houseId !== undefined && ready && focused ? houseId : undefined;

  // The next beat is the retry, so a failed one is not retried on its own.
  useQuery({
    queryKey: [HEARTBEAT_KEY, hosting],
    queryFn: hosting ? () => heartbeat(hosting) : skipToken,
    refetchInterval: HEARTBEAT_MS,
    retry: false,
    gcTime: 0,
  });
}

function refreshPrinters(houseId: string) {
  return queryClient.invalidateQueries({ queryKey: queries.printers(houseId).queryKey });
}

async function stopAdvertising(houseId: string) {
  // Leave the table right away instead of waiting to time out of it.
  await getDeviceId()
    .then((deviceId) => api.printerOffline(houseId, deviceId))
    .catch(() => {});
  await refreshPrinters(houseId);
}

// A single root observer owns the heartbeat. Keep the device awake only while it is sharing.
let advertisedHouse: string | undefined;
queryClient.getQueryCache().subscribe(({ type, query }) => {
  const queryKey: unknown = query.queryKey;
  if (!Array.isArray(queryKey) || queryKey[0] !== HEARTBEAT_KEY) {
    return;
  }
  const houseId: unknown = queryKey[1];
  if (typeof houseId !== 'string') {
    return;
  }
  const sharing = type !== 'removed' && query.isActive() && query.state.status === 'success';
  if (sharing && advertisedHouse !== houseId) {
    const previousHouse = advertisedHouse;
    advertisedHouse = houseId;
    if (previousHouse === undefined) {
      void activateKeepAwakeAsync(KEEP_AWAKE_TAG).catch(() => {});
    } else {
      void stopAdvertising(previousHouse);
    }
    void refreshPrinters(houseId);
  } else if (!sharing && advertisedHouse === houseId) {
    advertisedHouse = undefined;
    void deactivateKeepAwake(KEEP_AWAKE_TAG).catch(() => {});
    void stopAdvertising(houseId);
  }
});

/**
 * Print a label wherever possible:
 * 1. this device's printer, if it's connected;
 * 2. otherwise through a device in the box's house that has one;
 * 3. otherwise connect a printer here, when this device can.
 * `houseId` is the box's house. Resolves with the name of the other device that printed it, if one did.
 */
export async function printAnywhere(
  label: LabelInput,
  houseId: string,
): Promise<string | undefined> {
  const local = getPrinterState().status;
  if (!isReady(local)) {
    const deviceId = await getDeviceId();
    // Can't see the house's printers (offline, say): fall through to this device's own.
    const printers = await queryClient
      .query({ ...queries.printers(houseId), staleTime: PRINTERS_POLL_MS })
      .catch((): HouseholdPrinter[] => []);
    if (local === 'unsupported' || printers.some(isRemote(deviceId))) {
      return printRemote(label, houseId, deviceId);
    }
  }
  await serialized(() => printLabel(label));
  return undefined;
}

async function printRemote(label: LabelInput, houseId: string, deviceId: string): Promise<string> {
  try {
    let job = await api.createPrintJob(houseId, deviceId, label);
    const queuedVia = job.via;
    const deadline = Date.now() + JOB_TIMEOUT_MS;
    // A plain loop rather than a polled query: the caller is a mutation awaiting one job's outcome.
    while (job.status === 'queued' || job.status === 'printing') {
      if (Date.now() > deadline) {
        throw new Error('The printer did not respond in time.');
      }
      // oxlint-disable-next-line no-await-in-loop -- polling: each round waits for the one before
      await sleep(JOB_POLL_MS);
      // oxlint-disable-next-line no-await-in-loop -- as above
      job = await api.getPrintJob(houseId, job.id);
    }
    if (job.status === 'failed') {
      throw new Error(job.error ?? 'Printing failed.');
    }
    return job.via ?? queuedVia ?? 'another device';
  } catch (error) {
    // The table was probably stale; update the UI.
    void queryClient.invalidateQueries({ queryKey: queries.printers(houseId).queryKey });
    throw error;
  }
}
