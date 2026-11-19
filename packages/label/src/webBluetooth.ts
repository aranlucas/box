// Web Bluetooth transport for the Phomemo D30 (Chromium only: Chrome/Edge desktop + Android).
import { chunks, type D30Job } from './encode';

export const D30_SERVICE = 0xff00;
export const D30_WRITE_CHAR = 0xff02;
const CHUNK = 128;

declare function setTimeout(cb: () => void, ms: number): unknown;

export interface D30Connection {
  name: string;
  print(job: D30Job): Promise<void>;
  disconnect(): void;
  connected(): boolean;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const bt = (): any => (globalThis as any).navigator?.bluetooth;

export function isWebBluetoothAvailable(): boolean {
  return !!bt();
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function open(device: any): Promise<D30Connection> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let ch: any;
  const attach = async () => {
    const server = await device.gatt.connect();
    await sleep(100);
    const service = await server.getPrimaryService(D30_SERVICE);
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

  let busy: Promise<void> = Promise.resolve();
  return {
    name: device.name ?? 'D30',
    connected: () => !!device.gatt?.connected,
    disconnect: () => device.gatt?.connected && device.gatt.disconnect(),
    print(job: D30Job) {
      // serialize jobs, with a pause between them
      const run = busy.then(async () => {
        if (!device.gatt.connected) await attach();
        await write(job.header);
        for (const c of chunks(job.data, CHUNK)) await write(c);
        await write(job.footer);
        await sleep(500);
      });
      busy = run.catch(() => undefined);
      return run;
    },
  };
}

/** Show the browser's device picker (requires a user gesture) and connect. */
export async function connectD30(opts: { acceptAll?: boolean } = {}): Promise<D30Connection> {
  const b = bt();
  if (!b) throw new Error('Web Bluetooth is not available in this browser. Use Chrome on Android or desktop.');
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
  if (!b || typeof b.getDevices !== 'function') return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const devices: any[] = await b.getDevices();
  const device = devices.find((d) => (d.name ?? '').startsWith('D')) ?? devices[0];
  if (!device) return null;
  try {
    return await open(device);
  } catch {
    return null;
  }
}
