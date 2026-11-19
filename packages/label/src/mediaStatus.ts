declare function setTimeout(cb: () => void, ms: number): unknown;
declare function clearTimeout(timer: unknown): void;

const COVER_QUERY = Uint8Array.of(0x1f, 0x11, 0x12);
const PAPER_QUERY = Uint8Array.of(0x1f, 0x11, 0x11);
const STATUS_REPLY_MS = 300;

export type SubscribeToMediaStatus = (
  onPacket: (packet: Uint8Array | undefined) => void,
) => (() => void | Promise<void>) | Promise<() => void | Promise<void>>;

/** Check the D-series sensors before sending a raster. A missing reply leaves that sensor unknown. */
export async function checkD30Media(
  write: (bytes: Uint8Array) => Promise<void>,
  subscribe: SubscribeToMediaStatus,
): Promise<void> {
  let cover: 'open' | 'closed' | undefined;
  let paper: 'out' | 'loaded' | undefined;
  let available = true;
  let wake: (() => void) | undefined;
  let stop: Awaited<ReturnType<SubscribeToMediaStatus>> | undefined;
  const finished = () =>
    !available || cover === 'open' || (cover !== undefined && paper !== undefined);

  try {
    stop = await subscribe((packet) => {
      if (!packet) {
        available = false;
      } else {
        for (let offset = 0; offset + 2 < packet.length && packet[offset] === 0x1a; offset += 3) {
          const type = packet[offset + 1];
          const value = packet[offset + 2];
          // The T02 and M02X captures agree on the cover bit. D30 hardware verification is pending.
          if (type === 0x05 && value === 0x98) {
            cover = 'closed';
          }
          if (type === 0x05 && value === 0x99) {
            cover = 'open';
          }
          if (type === 0x06 && value === 0x88) {
            paper = 'out';
          }
          if (type === 0x06 && value === 0x89) {
            paper = 'loaded';
          }
          if (type !== 0x05 && type !== 0x06) {
            break;
          }
        }
      }
      if (finished()) {
        wake?.();
      }
    });

    // Retry unanswered queries once in case the native monitor was still being enabled.
    // oxlint-disable no-await-in-loop -- Each retry depends on the replies from the previous attempt.
    for (let attempt = 0; attempt < 2 && !finished(); attempt++) {
      if (cover === undefined) {
        await write(COVER_QUERY);
      }
      if (!finished() && paper === undefined) {
        await write(PAPER_QUERY);
      }
      if (!finished()) {
        await new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, STATUS_REPLY_MS);
          wake = () => {
            clearTimeout(timer);
            resolve();
          };
        });
      }
    }
    // oxlint-enable no-await-in-loop
  } catch {
    // Some firmware does not support status queries. Continue with any replies already received.
  } finally {
    try {
      await stop?.();
    } catch {
      // Notification cleanup can fail if the connection closed during the check.
    }
  }

  if (cover === 'open') {
    throw new Error('Close the printer cover, then try again.');
  }
  if (paper === 'out') {
    throw new Error('The printer is out of labels. Load a roll, then try again.');
  }
}
