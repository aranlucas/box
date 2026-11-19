// Household printer sharing: print from any device through whichever household device has the
// D30 connected. Works on every platform (it's just HTTP), so an iPhone — which has no Web
// Bluetooth — can print through an Android phone or a Chrome tab that's connected.
//
// - Host: while this device's printer is connected and the app is in the foreground, heartbeat
//   the Worker every couple of seconds. The heartbeat keeps our row in the connection status table
//   fresh and returns queued jobs, which we claim, print and complete.
// - Requester: poll the table so the UI can say "Print via <device>", queue a job and wait for it.
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { AppState } from 'react-native';

import { api, getHouseholdKey, type HouseholdPrinter, type QueuedJob, type RemoteLabel } from './api';
import { deviceName, getDeviceId } from './device';
import { getPrinterState, printLabel, subscribePrinter } from './printer';
import { createStore } from './printer-store';

const HEARTBEAT_MS = 2_000;
const LIST_MS = 5_000;
const NO_KEY_MS = 15_000;
const JOB_POLL_MS = 1_000;
const JOB_TIMEOUT_MS = 45_000;

type HouseholdState = {
  /** The connection status table: household devices that can print right now (may include this one). */
  printers: HouseholdPrinter[];
  deviceId?: string;
  /** True while this device is offering its printer to the household. */
  sharing: boolean;
  /** Last label this device printed for someone else. */
  lastServed?: { number: number; at: number };
};

const store = createStore<HouseholdState>({ printers: [], sharing: false });
export const useHousehold = store.useState;

// While sharing, keep the host's screen on: if it auto-locks, the app backgrounds and stops sharing.
const KEEP_AWAKE_TAG = 'household-printer';
let awake = false;
store.subscribe(() => {
  const { sharing } = store.get();
  if (sharing === awake) return;
  awake = sharing;
  if (sharing) activateKeepAwakeAsync(KEEP_AWAKE_TAG).catch(() => {});
  else deactivateKeepAwake(KEEP_AWAKE_TAG).catch(() => {});
});

// One print at a time on this device, so a relayed job and a local tap never interleave chunks.
let printQueue: Promise<unknown> = Promise.resolve();
function serialized<T>(fn: () => Promise<T>): Promise<T> {
  const run = printQueue.then(fn, fn);
  printQueue = run.catch(() => {});
  return run;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));
const localReady = () => {
  const s = getPrinterState().status;
  return s === 'connected' || s === 'printing';
};

/** Printers on *other* household devices, most recently seen first. */
export function remotePrinters(state: HouseholdState = store.get()): HouseholdPrinter[] {
  return state.printers.filter((p) => p.device_id !== state.deviceId);
}

let started = false;
let timer: ReturnType<typeof setTimeout> | null = null;
let ticking = false;
let rerun = false;
let registered = false;
let lastListAt = 0;

/** Start sharing/polling. Call once at app start; safe to call again. */
export function startHousehold() {
  if (started) return;
  started = true;
  getDeviceId().then((deviceId) => store.set({ deviceId }));
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

/** Run a tick now (e.g. after entering the household key or a failed remote print). */
export function refreshHousehold() {
  if (timer) clearTimeout(timer);
  timer = null;
  lastListAt = 0;
  void tick();
}

async function tick() {
  if (ticking) {
    rerun = true;
    return;
  }
  ticking = true;
  let next: number | null = LIST_MS;
  try {
    if (AppState.currentState === 'background') {
      // BLE background mode is off and timers get throttled: stop advertising, resume on foreground.
      next = null;
      await goOffline();
      return;
    }
    if (!(await getHouseholdKey())) {
      next = NO_KEY_MS;
      return;
    }
    const deviceId = await getDeviceId();
    if (localReady()) {
      next = HEARTBEAT_MS;
      const jobs = await api.printerHeartbeat({ deviceId, deviceName: deviceName(), printerName: getPrinterState().name });
      registered = true;
      if (!store.get().sharing) store.set({ sharing: true });
      for (const job of jobs) await serve(job, deviceId);
    } else {
      await goOffline();
    }
    if (Date.now() - lastListAt >= LIST_MS) {
      lastListAt = Date.now();
      store.set({ printers: await api.listPrinters() });
    }
  } catch {
    // Network blip: try again next tick.
  } finally {
    ticking = false;
    if (rerun) {
      rerun = false;
      void tick();
    } else if (next !== null) {
      timer = setTimeout(() => void tick(), next);
    }
  }
}

async function goOffline() {
  if (!registered) return;
  registered = false;
  store.set({ sharing: false });
  await api.printerOffline(await getDeviceId()).catch(() => {});
}

/** Print a job relayed from another device. Never scans or opens a picker: only prints if already connected. */
async function serve(job: QueuedJob, deviceId: string) {
  if (getPrinterState().status !== 'connected') return; // busy or gone: leave it for another host, or to expire
  try {
    await api.claimPrintJob(job.id, deviceId);
  } catch {
    return; // another device took it, or it expired
  }
  try {
    await serialized(() => printLabel(job.label, { connect: false }));
    store.set({ lastServed: { number: job.label.number, at: Date.now() } });
    await api.completePrintJob(job.id, deviceId, { ok: true }).catch(() => {});
  } catch (e) {
    await api.completePrintJob(job.id, deviceId, { ok: false, error: errMsg(e) }).catch(() => {});
  }
}

/**
 * Print a label wherever possible:
 * 1. this device's printer, if it's connected;
 * 2. otherwise through a household device that has one;
 * 3. otherwise connect a printer here (the original flow), when this device can.
 * Resolves with the name of the device that printed it (null = this one).
 */
export async function printAnywhere(label: RemoteLabel): Promise<{ via: string | null }> {
  const local = getPrinterState().status;
  if (local === 'connected' || local === 'printing') {
    await serialized(() => printLabel(label));
    return { via: null };
  }
  if (remotePrinters().length || local === 'unsupported') return printRemote(label);
  await serialized(() => printLabel(label));
  return { via: null };
}

async function printRemote(label: RemoteLabel): Promise<{ via: string | null }> {
  try {
    let job = await api.createPrintJob(await getDeviceId(), label);
    const queuedVia = job.via;
    const deadline = Date.now() + JOB_TIMEOUT_MS;
    while (job.status === 'queued' || job.status === 'printing') {
      if (Date.now() > deadline) throw new Error('The printer did not respond in time.');
      await sleep(JOB_POLL_MS);
      job = await api.getPrintJob(job.id);
    }
    if (job.status === 'failed') throw new Error(job.error ?? 'Printing failed.');
    return { via: job.via ?? queuedVia };
  } catch (e) {
    refreshHousehold(); // the table was probably stale; update the UI
    throw e;
  }
}
