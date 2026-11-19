import { buildJob, type LabelInput, type Rotation } from '@mj/label';
import {
  connectD30,
  isWebBluetoothAvailable,
  reconnect,
  type D30Connection,
} from '@mj/label/webBluetooth';

import { createStore, type PrinterState } from './store';
import { errorMessage } from './util';

const store = createStore<PrinterState>({
  status: isWebBluetoothAvailable() ? 'disconnected' : 'unsupported',
  name: 'D30',
});
let conn: D30Connection | undefined;

export const usePrinter = store.useState;
export const getPrinterState = store.get;
export const subscribePrinter = store.subscribe;

function connected(connection: D30Connection) {
  conn = connection;
  store.set({ status: 'connected', name: connection.name, error: undefined });
}

/** Must be called from a tap/click (Web Bluetooth requires a user gesture to show the picker). */
export async function connectPrinter(opts: { acceptAll?: boolean } = {}) {
  if (!isWebBluetoothAvailable()) {
    return;
  }
  store.set({ status: 'connecting', error: undefined });
  try {
    connected(await connectD30(opts));
  } catch (error) {
    conn = undefined;
    const message = errorMessage(error);
    // Closing the browser's device picker is not an error worth showing.
    store.set({ status: 'disconnected', error: /cancel/i.test(message) ? undefined : message });
  }
}

/** Try a silent reconnect to a printer this browser was already given permission for. */
export async function tryReconnect() {
  if (!isWebBluetoothAvailable() || conn?.connected()) {
    return;
  }
  // Silent on failure: the user can still tap "Connect printer".
  const connection = await reconnect().catch(() => null);
  if (connection) {
    connected(connection);
  }
}

export function disconnectPrinter() {
  conn?.disconnect();
  conn = undefined;
  store.set({ status: 'disconnected' });
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
  const connection = conn;
  if (!connection?.connected()) {
    throw new Error(store.get().error ?? 'Printer not connected');
  }
  store.set({ status: 'printing', error: undefined });
  try {
    await connection.print(buildJob(input, rotation), { checkMedia });
    store.set({ status: 'connected' });
  } catch (error) {
    store.set({
      status: connection.connected() ? 'connected' : 'disconnected',
      error: errorMessage(error),
    });
    throw error;
  }
}
