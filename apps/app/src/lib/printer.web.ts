import { buildJob, type LabelInput, type Rotation } from '@mj/label';
import {
  connectD30,
  isWebBluetoothAvailable,
  reconnect,
  type D30Connection,
} from '@mj/label/webBluetooth';

import { createPrinterStore } from './printer-store';

const store = createPrinterStore({
  status: isWebBluetoothAvailable() ? 'disconnected' : 'unsupported',
});
let conn: D30Connection | null = null;

export const usePrinter = store.useState;
export const getPrinterState = store.get;
export const subscribePrinter = store.subscribe;

/** Must be called from a tap/click (Web Bluetooth requires a user gesture to show the picker). */
export async function connectPrinter(opts: { acceptAll?: boolean } = {}) {
  if (!isWebBluetoothAvailable()) {
    return;
  }
  store.set({ status: 'connecting', error: undefined });
  try {
    conn = await connectD30(opts);
    store.set({ status: 'connected', name: conn.name });
  } catch (err) {
    conn = null;
    const msg = err instanceof Error ? err.message : String(err);
    store.set({ status: 'disconnected', error: /cancel/i.test(msg) ? undefined : msg });
  }
}

/** Try a silent reconnect to a printer this browser was already given permission for. */
export async function tryReconnect() {
  if (!isWebBluetoothAvailable() || conn?.connected()) {
    return;
  }
  try {
    const c = await reconnect();
    if (c) {
      conn = c;
      store.set({ status: 'connected', name: c.name, error: undefined });
    }
  } catch {
    // Silent: the user can still tap "Connect printer".
  }
}

export function disconnectPrinter() {
  conn?.disconnect();
  conn = null;
  store.set({ status: 'disconnected', name: undefined });
}

/**
 * Print on this device's printer. With `connect: false` (used when printing a job relayed from
 * another device in the house) it never opens a picker or scans: it prints only if already connected.
 */
export async function printLabel(
  input: LabelInput,
  opts: { rotation?: Rotation; connect?: boolean; checkMedia?: boolean } = {},
) {
  const { rotation = 'cw', connect = true, checkMedia = false } = opts;
  if (connect && !conn?.connected()) {
    await tryReconnect();
    if (!conn?.connected()) {
      await connectPrinter();
    }
  }
  if (!conn?.connected()) {
    throw new Error('Printer not connected');
  }
  store.set({ status: 'printing', error: undefined });
  try {
    await conn.print(buildJob(input, rotation), { checkMedia });
    store.set({ status: 'connected' });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    store.set({ status: conn?.connected() ? 'connected' : 'disconnected', error: msg });
    throw err;
  }
}
