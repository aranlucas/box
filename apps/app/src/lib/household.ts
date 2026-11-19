// Shared printing within a house: print from any member's device through whichever device in the
// current house has the D30 connected. Works on every platform (it's just HTTP), so an iPhone —
// which has no Web Bluetooth — can print through an Android phone or a Chrome tab that's connected.
//
// - Host: while this device's printer is connected and the app is in the foreground, heartbeat
//   the Worker every couple of seconds. The heartbeat keeps our row in the connection status table
//   fresh and returns queued jobs, which we claim, print and complete.
// - Requester: poll the table so the UI can say "Print via <device>", queue a job and wait for it.
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { AppState } from 'react-native';

import type { LabelInput } from '@mj/label';

import { api, type HouseholdPrinter, type QueuedJob } from './api';
import { deviceName, getDeviceId } from './device';
import { getPrinterState, printLabel, subscribePrinter } from './printer';
import { createStore, isReady } from './store';
import { errorMessage, sleep } from './util';

const HEARTBEAT_MS = 2_000;
const LIST_MS = 5_000;
const JOB_POLL_MS = 1_000;
const JOB_TIMEOUT_MS = 45_000;

type HouseholdState = {
  /** The house this device is looking at (from the session); sharing and printing are scoped to it. */
  houseId?: string;
  /** The connection status table: devices in the house that can print right now (may include this one). */
  printers: HouseholdPrinter[];
  deviceId?: string;
  /** True while this device is offering its printer to the household. */
  sharing: boolean;
};

const store = createStore<HouseholdState>({ printers: [], sharing: false });
export const useHousehold = store.useState;

// While sharing, keep the host's screen on: if it auto-locks, the app backgrounds and stops sharing.
const KEEP_AWAKE_TAG = 'household-printer';
let awake = false;
store.subscribe(() => {
  const { sharing } = store.get();
  if (sharing === awake) {
    return;
  }
  awake = sharing;
  if (sharing) {
    activateKeepAwakeAsync(KEEP_AWAKE_TAG).catch(() => {});
  } else {
    deactivateKeepAwake(KEEP_AWAKE_TAG).catch(() => {});
  }
});

// One print at a time on this device, so a relayed job and a local tap never interleave chunks.
let printQueue: Promise<unknown> = Promise.resolve();
function serialized<T>(fn: () => Promise<T>): Promise<T> {
  const run = printQueue.then(fn, fn);
  printQueue = run.catch(() => {});
  return run;
}

const localReady = () => isReady(getPrinterState().status);
/** The table as the UI shows it; `last_seen` moves on every poll and is not shown. */
const tableKey = (printers: HouseholdPrinter[]) =>
  printers.map((p) => [p.device_id, p.device_name, p.printer_name].join('|')).join('\n');

/** Printers on *other* household devices, most recently seen first. */
export function remotePrinters(state: HouseholdState = store.get()): HouseholdPrinter[] {
  return state.printers.filter((p) => p.device_id !== state.deviceId);
}

let started = false;
let timer: ReturnType<typeof setTimeout> | undefined;
let ticking = false;
let rerun = false;
/** The house this device is currently advertising its printer to, if any. */
let registeredIn: string | undefined;
let lastListAt = 0;

/** Start sharing/polling. Call once at app start; safe to call again. */
export function startHousehold() {
  if (started) {
    return;
  }
  started = true;
  void getDeviceId().then((deviceId) => store.set({ deviceId }));
  AppState.addEventListener('change', refreshHousehold);
  // React right away when the local printer connects or disconnects.
  let wasReady = localReady();
  subscribePrinter(() => {
    if (localReady() !== wasReady) {
      wasReady = localReady();
      refreshHousehold();
    }
  });
  refreshHousehold();
}

/** Follow the session's current house. Call whenever it changes (undefined when signed out). */
export function setHouseholdHouse(houseId: string | undefined) {
  if (store.get().houseId === houseId) {
    return;
  }
  store.set({ houseId, printers: [] });
  refreshHousehold();
}

/** Run a tick now (e.g. after a failed remote print). */
export function refreshHousehold() {
  clearTimeout(timer);
  lastListAt = 0;
  void tick();
}

async function tick() {
  if (ticking) {
    rerun = true;
    return;
  }
  ticking = true;
  // A network blip just means trying again on the next tick.
  const next = await poll().catch(() => (localReady() ? HEARTBEAT_MS : LIST_MS));
  ticking = false;
  if (rerun) {
    rerun = false;
    void tick();
  } else if (next) {
    timer = setTimeout(() => {
      void tick();
    }, next);
  }
}

/** One round of sharing and listing. Resolves with the delay before the next round; none means "stay idle". */
async function poll(): Promise<number | undefined> {
  if (AppState.currentState === 'background') {
    // BLE background mode is off and timers get throttled: stop advertising, resume on foreground.
    await goOffline();
    return undefined;
  }
  const { houseId } = store.get();
  // Switched house or signed out
  if (registeredIn !== houseId) {
    await goOffline();
  }
  // Resumed by setHouseholdHouse
  if (!houseId) {
    return undefined;
  }
  const deviceId = await getDeviceId();
  const hosting = localReady();
  if (hosting) {
    const jobs = await api.printerHeartbeat(houseId, {
      deviceId,
      deviceName: deviceName(),
      printerName: getPrinterState().name,
    });
    registeredIn = houseId;
    if (!store.get().sharing) {
      store.set({ sharing: true });
    }
    for (const job of jobs) {
      // oxlint-disable-next-line no-await-in-loop -- one printer: labels print one after another
      await serve(houseId, job, deviceId);
    }
  } else {
    await goOffline();
  }
  if (Date.now() - lastListAt >= LIST_MS) {
    lastListAt = Date.now();
    const printers = await api.listPrinters(houseId);
    // Leave the store alone when nothing visible changed, so the screens showing it don't re-render every poll.
    const current = store.get();
    if (current.houseId === houseId && tableKey(printers) !== tableKey(current.printers)) {
      store.set({ printers });
    }
  }
  return hosting ? HEARTBEAT_MS : LIST_MS;
}

async function goOffline() {
  const houseId = registeredIn;
  if (!houseId) {
    return;
  }
  registeredIn = undefined;
  store.set({ sharing: false });
  await api.printerOffline(houseId, await getDeviceId()).catch(() => {});
}

/** Print a job relayed from another device. Never scans or opens a picker: only prints if already connected. */
async function serve(houseId: string, job: QueuedJob, deviceId: string) {
  // Busy or gone: leave it for another host, or to expire
  if (getPrinterState().status !== 'connected') {
    return;
  }
  try {
    await api.claimPrintJob(houseId, job.id, deviceId);
  } catch {
    return; // another device took it, or it expired
  }
  try {
    await serialized(() => printLabel(job.label, { connect: false, checkMedia: true }));
    await api.completePrintJob(houseId, job.id, deviceId, { ok: true }).catch(() => {});
  } catch (error) {
    await api
      .completePrintJob(houseId, job.id, deviceId, { ok: false, error: errorMessage(error) })
      .catch(() => {});
  }
}

/**
 * Print a label wherever possible:
 * 1. this device's printer, if it's connected;
 * 2. otherwise through a device in the current house that has one;
 * 3. otherwise connect a printer here (the original flow), when this device can.
 * `houseId` is the box's house. Resolves with the name of the other device that printed it, if one did.
 */
export async function printAnywhere(
  label: LabelInput,
  houseId: string,
): Promise<string | undefined> {
  const local = getPrinterState().status;
  const remoteHere = houseId === store.get().houseId && remotePrinters().length > 0;
  if (!isReady(local) && (remoteHere || local === 'unsupported')) {
    return printRemote(label, houseId);
  }
  await serialized(() => printLabel(label));
  return undefined;
}

async function printRemote(label: LabelInput, houseId: string): Promise<string> {
  try {
    let job = await api.createPrintJob(houseId, await getDeviceId(), label);
    const queuedVia = job.via;
    const deadline = Date.now() + JOB_TIMEOUT_MS;
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
    refreshHousehold(); // the table was probably stale; update the UI
    throw error;
  }
}
