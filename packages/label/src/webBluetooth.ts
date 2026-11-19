// Web Bluetooth transport for the Phomemo D30 (Chromium only: Chrome/Edge desktop + Android).
import { chunks, type D30Job } from './encode';
import { checkD30Media, type SubscribeToMediaStatus } from './mediaStatus';

export const D30_SERVICE = 0xff00;
export const D30_WRITE_CHAR = 0xff02;
const D30_NOTIFY_CHAR = 0xff03;
const CHUNK = 128;

declare function setTimeout(cb: () => void, ms: number): unknown;

export type D30Connection = {
  name: string;
  print(job: D30Job, opts?: { checkMedia?: boolean }): Promise<void>;
  disconnect(): void;
  connected(): boolean;
};

// Web Bluetooth is missing from TypeScript's standard library.
type CharacteristicListener = (event: { target: { value?: DataView } }) => void;
type GattCharacteristic = {
  writeValue(bytes: Uint8Array): Promise<void>;
  writeValueWithResponse?(bytes: Uint8Array): Promise<void>;
  writeValueWithoutResponse?(bytes: Uint8Array): Promise<void>;
  addEventListener(event: 'characteristicvaluechanged', listener: CharacteristicListener): void;
  removeEventListener(event: 'characteristicvaluechanged', listener: CharacteristicListener): void;
  startNotifications(): Promise<unknown>;
  stopNotifications(): Promise<unknown>;
};
type GattService = {
  getCharacteristic(uuid: number): Promise<GattCharacteristic>;
};
type GattServer = {
  connected: boolean;
  connect(): Promise<GattServer>;
  disconnect(): void;
  getPrimaryService(uuid: number): Promise<GattService>;
};
type BluetoothDevice = {
  name?: string;
  gatt?: GattServer;
};
type Bluetooth = {
  requestDevice(options: {
    acceptAllDevices?: boolean;
    filters?: { namePrefix: string }[];
    optionalServices: number[];
  }): Promise<BluetoothDevice>;
  getDevices?(): Promise<BluetoothDevice[]>;
};

declare const navigator: { bluetooth?: Bluetooth };

const sleep = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

const bt = () => navigator.bluetooth;

export function isWebBluetoothAvailable(): boolean {
  return !!bt();
}

async function open(device: BluetoothDevice): Promise<D30Connection> {
  const { gatt } = device;
  if (!gatt) {
    throw new Error('The selected device has no Bluetooth GATT server.');
  }
  let ch: GattCharacteristic;
  let service: GattService;
  const attach = async () => {
    const server = await gatt.connect();
    await sleep(100);
    service = await server.getPrimaryService(D30_SERVICE);
    ch = await service.getCharacteristic(D30_WRITE_CHAR);
  };
  try {
    await attach();
  } catch {
    await sleep(500);
    await attach(); // one retry
  }

  const write = async (bytes: Uint8Array) => {
    if (typeof ch.writeValueWithResponse === 'function') {
      await ch.writeValueWithResponse(bytes);
    } else if (typeof ch.writeValueWithoutResponse === 'function') {
      await ch.writeValueWithoutResponse(bytes);
      await sleep(20);
    } else {
      await ch.writeValue(bytes);
    }
  };

  const subscribeToMedia: SubscribeToMediaStatus = async (onPacket) => {
    const notify = await service.getCharacteristic(D30_NOTIFY_CHAR);
    const onValue: CharacteristicListener = (event) => {
      const value = event.target.value;
      if (value) {
        onPacket(new Uint8Array(value.buffer, value.byteOffset, value.byteLength));
      }
    };
    notify.addEventListener('characteristicvaluechanged', onValue);
    try {
      await notify.startNotifications();
    } catch (error) {
      notify.removeEventListener('characteristicvaluechanged', onValue);
      throw error;
    }
    return async () => {
      notify.removeEventListener('characteristicvaluechanged', onValue);
      await notify.stopNotifications();
    };
  };

  let busy: Promise<void> = Promise.resolve();
  return {
    name: device.name ?? 'D30',
    connected: () => gatt.connected,
    disconnect: () => {
      if (gatt.connected) {
        gatt.disconnect();
      }
    },
    print(job: D30Job, { checkMedia = false } = {}) {
      // serialize jobs, with a pause between them
      const run = busy.then(async () => {
        if (!gatt.connected) {
          await attach();
        }
        if (checkMedia && /^D30/i.test(device.name ?? '')) {
          await checkD30Media(write, subscribeToMedia);
        }
        await write(job.header);
        for (const c of chunks(job.data, CHUNK)) {
          // oxlint-disable-next-line no-await-in-loop -- BLE writes must arrive in byte order.
          await write(c);
        }
        await write(job.footer);
        return sleep(500);
      });
      busy = run.catch(() => undefined);
      return run;
    },
  };
}

/** Show the browser's device picker (requires a user gesture) and connect. */
export async function connectD30(opts: { acceptAll?: boolean } = {}): Promise<D30Connection> {
  const b = bt();
  if (!b) {
    throw new Error(
      'Web Bluetooth is not available in this browser. Use Chrome on Android or desktop.',
    );
  }
  const device = await b.requestDevice(
    opts.acceptAll
      ? { acceptAllDevices: true, optionalServices: [D30_SERVICE] }
      : { filters: [{ namePrefix: 'D30' }, { namePrefix: 'D' }], optionalServices: [D30_SERVICE] },
  );
  return open(device);
}

/** Reconnect to a previously permitted printer without the picker, if the browser supports getDevices(). */
export async function reconnect(): Promise<D30Connection | null> {
  const b = bt();
  if (!b || typeof b.getDevices !== 'function') {
    return null;
  }
  const devices = await b.getDevices();
  const device = devices.find((d) => (d.name ?? '').startsWith('D')) ?? devices[0];
  if (!device) {
    return null;
  }
  try {
    return await open(device);
  } catch {
    return null;
  }
}
