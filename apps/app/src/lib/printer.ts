// Native (Android) printer. BLE via react-native-ble-plx lands in the native build milestone;
// until then the Android app can create/edit boxes and the web app (Chrome) prints.
import type { LabelInput, Rotation } from '@mj/label';

import { createPrinterStore } from './printer-store';

const store = createPrinterStore({ status: 'unsupported' });

export const usePrinter = store.useState;
export const printerHelp = 'Printing from the Android app is coming soon. Use the web app in Chrome to print for now.';

export async function connectPrinter(_opts: { acceptAll?: boolean } = {}) {}
export async function tryReconnect() {}
export function disconnectPrinter() {}
export async function printLabel(_input: LabelInput, _rotation: Rotation = 'cw'): Promise<void> {
  throw new Error(printerHelp);
}
