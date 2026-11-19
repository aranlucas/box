// Native (Android) printer: Phomemo D30 over BLE via react-native-ble-plx.
// Same print job bytes as the web build (from @mj/label); only the transport differs.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { buildJob, checkD30Media, chunks, type LabelInput, type Rotation } from '@mj/label';
import { PermissionsAndroid, Platform } from 'react-native';
import { BleManager, State, type Device } from 'react-native-ble-plx';

import { createPrinterStore } from './printer-store';

const SERVICE = '0000ff00-0000-1000-8000-00805f9b34fb';
const WRITE_CHAR = '0000ff02-0000-1000-8000-00805f9b34fb';
const NOTIFY_CHAR = '0000ff03-0000-1000-8000-00805f9b34fb';
const DEVICE_KEY = 'printer-device-id';
const SCAN_MS = 10_000;

let manager: BleManager | null = null;
const ble = () => (manager ??= new BleManager());

const store = createPrinterStore({ status: 'disconnected' });
let device: Device | null = null;
let chunkSize = 20;
let lastJobAt = 0;

export const usePrinter = store.useState;
export const getPrinterState = store.get;
export const subscribePrinter = store.subscribe;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

function toBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) {
    bin += String.fromCharCode(bytes[i]);
  }
  return btoa(bin);
}

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
    const t = setTimeout(() => {
      sub.remove();
      reject(new Error('Bluetooth is not available.'));
    }, 5000);
    const sub = ble().onStateChange((s) => {
      if (s === State.PoweredOn) {
        clearTimeout(t);
        sub.remove();
        resolve();
      }
    }, true);
  });
}

const isD30 = (d: Device) => /^D30/i.test(d.name ?? d.localName ?? '');

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
    const timer = setTimeout(
      () =>
        finish(() =>
          reject(new Error('No D30 printer found. Turn it on and keep it close to the phone.')),
        ),
      SCAN_MS,
    );
    // FF00 isn't advertised by the D30, so scan without a service filter and match by name.
    ble()
      .startDeviceScan(null, { allowDuplicates: false }, (error, d) => {
        if (error) {
          finish(() => reject(error));
          return;
        }
        if (!d) {
          return;
        }
        const name = d.name ?? d.localName ?? '';
        if (isD30(d) || (acceptAll && /^D\d/i.test(name))) {
          finish(() => resolve(d));
        }
      })
      .catch((e) => finish(() => reject(e)));
  });
}

async function attach(d: Device) {
  let connected = await d.connect({ requestMTU: 185, timeout: 10_000 });
  await sleep(100);
  connected = await connected.discoverAllServicesAndCharacteristics();
  chunkSize = Math.max(20, Math.min(128, (connected.mtu ?? 23) - 3));
  device = connected;
  connected.onDisconnected(() => {
    if (device?.id === connected.id) {
      device = null;
      if (store.get().status !== 'connecting') {
        store.set({ status: 'disconnected' });
      }
    }
  });
  await AsyncStorage.setItem(DEVICE_KEY, connected.id);
  store.set({ status: 'connected', name: connected.name ?? 'D30', error: undefined });
}

async function isConnected() {
  if (!device) {
    return false;
  }
  try {
    return await device.isConnected();
  } catch {
    return false;
  }
}

export async function connectPrinter(opts: { acceptAll?: boolean } = {}) {
  store.set({ status: 'connecting', error: undefined });
  try {
    await ensurePermissions();
    await ensurePoweredOn();
    const d = await scanForPrinter(!!opts.acceptAll);
    await attach(d);
  } catch (e) {
    device = null;
    store.set({ status: 'disconnected', error: errMsg(e) });
  }
}

/** Reconnect to the last printer used, without scanning. Silent on failure. */
export async function tryReconnect() {
  if (await isConnected()) {
    return;
  }
  const id = await AsyncStorage.getItem(DEVICE_KEY).catch(() => null);
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
    if (known) {
      await attach(known);
    } else {
      await attach(await ble().connectToDevice(id, { requestMTU: 185, timeout: 6000 }));
    }
  } catch {
    device = null;
    store.set({ status: 'disconnected' });
  }
}

export function disconnectPrinter() {
  const d = device;
  device = null;
  store.set({ status: 'disconnected', name: undefined });
  d?.cancelConnection().catch(() => {});
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
  if (!(await isConnected())) {
    throw new Error(store.get().error ?? 'Printer not connected');
  }
  const printer = device;
  if (!printer) {
    throw new Error('Printer not connected');
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
    if (checkMedia && isD30(printer)) {
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
        return () => subscription.remove();
      });
    }
    const job = buildJob(input, rotation);
    await write(job.header);
    for (const c of chunks(job.data, chunkSize)) {
      // oxlint-disable-next-line no-await-in-loop -- BLE writes must arrive in byte order.
      await write(c);
    }
    await write(job.footer);
    lastJobAt = Date.now();
    store.set({ status: 'connected' });
  } catch (e) {
    store.set({ status: (await isConnected()) ? 'connected' : 'disconnected', error: errMsg(e) });
    throw e;
  }
}
