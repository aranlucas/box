// Native (Android) printer: Phomemo D30 over BLE via react-native-ble-plx.
// Same print job bytes as the web build (from @box/label); only the transport differs.
import { buildJob, checkD30Media, chunks, type LabelInput, type Rotation } from '@box/label';
import { PermissionsAndroid, Platform } from 'react-native';
import { BleManager, State, type Device } from 'react-native-ble-plx';

import { preferenceKeys, preferences } from './preferences';
import { createStore, type PrinterState } from './store';
import { errorMessage, sleep, toBase64 } from './util';

const SERVICE = '0000ff00-0000-1000-8000-00805f9b34fb';
const WRITE_CHAR = '0000ff02-0000-1000-8000-00805f9b34fb';
const NOTIFY_CHAR = '0000ff03-0000-1000-8000-00805f9b34fb';
const SCAN_MS = 10_000;
/** The model this app is built for; its sibling "D…" printers speak the same raster protocol. */
const D30 = /^D30/i;
const ANY_D_SERIES = /^D\d/i;

let manager: BleManager | undefined;
const ble = () => (manager ??= new BleManager());

const store = createStore<PrinterState>({ status: 'disconnected', name: 'D30' });
let device: Device | undefined;
let chunkSize = 20;
let lastJobAt = 0;

export const usePrinter = store.useState;
export const getPrinterState = store.get;
export const subscribePrinter = store.subscribe;

async function ensurePermissions() {
  if (Platform.OS !== 'android') {
    return;
  }
  const perms =
    Platform.Version >= 31
      ? [
          PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
          PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
        ]
      : [PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION];
  const res = await PermissionsAndroid.requestMultiple(perms);
  if (!perms.every((p) => res[p] === PermissionsAndroid.RESULTS.GRANTED)) {
    throw new Error('Bluetooth permission is needed to print labels.');
  }
}

async function ensurePoweredOn() {
  const state = await ble().state();
  if (state === State.PoweredOn) {
    return;
  }
  if (state === State.PoweredOff) {
    throw new Error('Turn on Bluetooth to print.');
  }
  // Unknown/Resetting right after startup: wait briefly for it to settle.
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      subscription.remove();
      reject(new Error('Bluetooth is not available.'));
    }, 5000);
    const subscription = ble().onStateChange((next) => {
      if (next !== State.PoweredOn) {
        return;
      }
      clearTimeout(timeout);
      subscription.remove();
      resolve();
    }, true);
  });
}

/** Scan for the nearest D30 (or any Phomemo "D…" printer when acceptAll). */
function scanForPrinter(acceptAll: boolean): Promise<Device> {
  return new Promise((resolve, reject) => {
    let done = false;
    const finish = (fn: () => void) => {
      if (done) {
        return;
      }
      done = true;
      clearTimeout(timer);
      void ble().stopDeviceScan();
      fn();
    };
    const fail = (error: Error) => {
      finish(() => {
        reject(error);
      });
    };
    const timer = setTimeout(() => {
      fail(new Error('No D30 printer found. Turn it on and keep it close to the phone.'));
    }, SCAN_MS);
    const wanted = acceptAll ? ANY_D_SERIES : D30;
    // FF00 isn't advertised by the D30, so scan without a service filter and match by name.
    void ble()
      .startDeviceScan(null, { allowDuplicates: false }, (error, found) => {
        if (error) {
          fail(error);
        } else if (found && wanted.test(found.name ?? found.localName ?? '')) {
          finish(() => {
            resolve(found);
          });
        }
      })
      .catch(fail);
  });
}

async function attach(d: Device) {
  let connected = await d.connect({ requestMTU: 185, timeout: 10_000 });
  await sleep(100);
  connected = await connected.discoverAllServicesAndCharacteristics();
  chunkSize = Math.max(20, Math.min(128, connected.mtu - 3));
  device = connected;
  connected.onDisconnected(() => {
    if (device?.id !== connected.id) {
      return;
    }
    device = undefined;
    if (store.get().status !== 'connecting') {
      store.set({ status: 'disconnected' });
    }
  });
  await preferences.setItem(preferenceKeys.printerId, connected.id);
  store.set({ status: 'connected', name: connected.name ?? 'D30', error: undefined });
}

const isConnected = async () => (await device?.isConnected().catch(() => false)) ?? false;

export async function connectPrinter(opts: { acceptAll?: boolean } = {}) {
  store.set({ status: 'connecting', error: undefined });
  try {
    await ensurePermissions();
    await ensurePoweredOn();
    const d = await scanForPrinter(!!opts.acceptAll);
    await attach(d);
  } catch (error) {
    device = undefined;
    store.set({ status: 'disconnected', error: errorMessage(error) });
  }
}

/** Reconnect to the last printer used, without scanning. Silent on failure. */
export async function tryReconnect() {
  if (await isConnected()) {
    return;
  }
  const id = await preferences.getItem(preferenceKeys.printerId).catch(() => null);
  if (!id) {
    return;
  }
  try {
    await ensurePermissions();
    if ((await ble().state()) !== State.PoweredOn) {
      return;
    }
    store.set({ status: 'connecting', error: undefined });
    const [known] = await ble().devices([id]);
    await attach(known ?? (await ble().connectToDevice(id, { requestMTU: 185, timeout: 6000 })));
  } catch {
    device = undefined;
    store.set({ status: 'disconnected' });
  }
}

export function disconnectPrinter() {
  const leaving = device;
  device = undefined;
  store.set({ status: 'disconnected' });
  leaving?.cancelConnection().catch(() => {});
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
  if (connect && !(await isConnected())) {
    await tryReconnect();
    if (!(await isConnected())) {
      await connectPrinter();
    }
  }
  const printer = device;
  if (!printer || !(await isConnected())) {
    throw new Error(store.get().error ?? 'Printer not connected');
  }
  const write = async (bytes: Uint8Array) => {
    await printer.writeCharacteristicWithResponseForService(SERVICE, WRITE_CHAR, toBase64(bytes));
  };

  store.set({ status: 'printing', error: undefined });
  try {
    const wait = 500 - (Date.now() - lastJobAt); // printer needs a breather between jobs
    if (wait > 0) {
      await sleep(wait);
    }
    if (checkMedia && D30.test(printer.name ?? printer.localName ?? '')) {
      await checkD30Media(write, (onPacket) => {
        const subscription = printer.monitorCharacteristicForService(
          SERVICE,
          NOTIFY_CHAR,
          (error, characteristic) => {
            if (error) {
              onPacket(undefined);
            } else if (characteristic?.value) {
              onPacket(Uint8Array.from(atob(characteristic.value), (byte) => byte.charCodeAt(0)));
            }
          },
        );
        return () => {
          subscription.remove();
        };
      });
    }
    const job = buildJob(input, rotation);
    for (const bytes of [job.header, ...chunks(job.data, chunkSize), job.footer]) {
      // oxlint-disable-next-line no-await-in-loop -- the printer needs its chunks in order
      await write(bytes);
    }
    lastJobAt = Date.now();
    store.set({ status: 'connected' });
  } catch (error) {
    store.set({
      status: (await isConnected()) ? 'connected' : 'disconnected',
      error: errorMessage(error),
    });
    throw error;
  }
}
