export const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

export const sleep = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

/** Base64 of raw bytes (not of text). */
export function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

/** "1 item", "3 items". */
export const count = (n: number, noun: string) => `${n} ${noun}${n === 1 ? '' : 's'}`;
