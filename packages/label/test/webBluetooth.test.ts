import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { connectD30 } from '../src/webBluetooth';

const job = {
  header: Uint8Array.of(0x1b, 0x40),
  data: Uint8Array.of(0xff),
  footer: Uint8Array.of(0x1b, 0x64, 0x00),
};
const coverQuery = [0x1f, 0x11, 0x12];
const paperQuery = [0x1f, 0x11, 0x11];

async function mockPrinter(reply: (query: number) => number[] | undefined, supportsNotifications = true) {
  let listener: ((event: { target: { value: DataView } }) => void) | undefined;
  const notify = {
    addEventListener: vi.fn((_event: string, callback: typeof listener) => { listener = callback; }),
    removeEventListener: vi.fn(() => { listener = undefined; }),
    startNotifications: vi.fn(async () => {}),
    stopNotifications: vi.fn(async () => {}),
  };
  const writes: number[][] = [];
  const writer = {
    async writeValueWithResponse(bytes: Uint8Array) {
      writes.push([...bytes]);
      const response = bytes[0] === 0x1f ? reply(bytes[2]) : undefined;
      if (response) {
        const packet = Uint8Array.of(0, ...response);
        listener?.({ target: { value: new DataView(packet.buffer, 1) } });
      }
    },
  };
  const service = {
    async getCharacteristic(uuid: number) {
      if (uuid === 0xff02) return writer;
      if (uuid === 0xff03 && supportsNotifications) return notify;
      throw new Error('Characteristic unavailable');
    },
  };
  const gatt = {
    connected: true,
    async connect() { return { getPrimaryService: async () => service }; },
  };
  vi.stubGlobal('navigator', { bluetooth: { requestDevice: async () => ({ name: 'D30-test', gatt }) } });
  const connection = connectD30();
  await vi.runAllTimersAsync();
  return { connection: await connection, writes, notify };
}

describe('D30 shared print media check', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it.each([
    { coverReply: [0x1a, 0x06, 0x88, 0x1a, 0x05, 0x99], message: 'Close the printer cover', commands: [coverQuery] },
    { coverReply: [0x1a, 0x05, 0x98], message: 'The printer is out of labels', commands: [coverQuery, paperQuery] },
  ])('stops before sending the label when the printer reports a fault', async ({ coverReply, message, commands }) => {
    const { connection, writes, notify } = await mockPrinter((query) => query === 0x12 ? coverReply : [0x1a, 0x06, 0x88]);
    await expect(connection.print(job, { checkMedia: true })).rejects.toThrow(message);
    expect(writes).toEqual(commands);
    expect(notify.removeEventListener).toHaveBeenCalledOnce();
    expect(notify.stopNotifications).toHaveBeenCalledOnce();
  });

  it('prints after retrying a status query that initially got no reply', async () => {
    let coverQueries = 0;
    const { connection, writes } = await mockPrinter((query) => {
      if (query === 0x11) return [0x1a, 0x06, 0x89];
      if (++coverQueries === 2) return [0x1a, 0x05, 0x98];
    });
    const printing = connection.print(job, { checkMedia: true });
    await vi.runAllTimersAsync();
    await printing;
    expect(writes).toEqual([coverQuery, paperQuery, coverQuery, [...job.header], [...job.data], [...job.footer]]);
  });

  it.each([true, false])('still prints without a recognized status reply (FF03 available: %s)', async (hasNotify) => {
    const { connection, writes } = await mockPrinter(() => [0x1a, 0x05, 0x00], hasNotify);
    const printing = connection.print(job, { checkMedia: true });
    await vi.runAllTimersAsync();
    await printing;
    expect(writes.slice(-3)).toEqual([[...job.header], [...job.data], [...job.footer]]);
  });
});
