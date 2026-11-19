import type { Bitmap } from './bitmap';

export type Rotation = 'cw' | 'ccw';

export interface D30Job {
  header: Uint8Array;
  data: Uint8Array;
  footer: Uint8Array;
}

/**
 * Encode a landscape design bitmap as a Phomemo D30 ESC/POS raster job.
 * The design is rotated 90° so the printhead (96 dots across the 12 mm label) sees
 * rows of `height` dots; there are `width` rows.
 *   header: ESC @ · GS v 0 0 · wBytes(LE16) · rows(LE16)
 *   data:   row-major, MSB = leftmost dot, 1 = black
 *   footer: ESC d 0 (finish; printer feeds to the gap)
 */
export function encodeD30(bmp: Bitmap, rotation: Rotation = 'cw'): D30Job {
  const outW = bmp.height; // dots across the head
  const rows = bmp.width;
  const wBytes = Math.ceil(outW / 8);
  const data = new Uint8Array(wBytes * rows);

  for (let sy = 0; sy < bmp.height; sy++) {
    for (let sx = 0; sx < bmp.width; sx++) {
      if (!bmp.data[sy * bmp.width + sx]) {
        continue;
      }
      // cw: (x, y) -> (H-1-y, x);  ccw: (x, y) -> (y, W-1-x)
      const dx = rotation === 'cw' ? bmp.height - 1 - sy : sy;
      const dy = rotation === 'cw' ? sx : bmp.width - 1 - sx;
      data[dy * wBytes + (dx >> 3)] |= 0x80 >> (dx & 7);
    }
  }

  const header = new Uint8Array([
    0x1b,
    0x40,
    0x1d,
    0x76,
    0x30,
    0x00,
    wBytes & 0xff,
    (wBytes >> 8) & 0xff,
    rows & 0xff,
    (rows >> 8) & 0xff,
  ]);
  const footer = new Uint8Array([0x1b, 0x64, 0x00]);
  return { header, data, footer };
}

export function chunks(bytes: Uint8Array, size: number): Uint8Array[] {
  if (size <= 0) {
    throw new Error('chunk size must be > 0');
  }
  const out: Uint8Array[] = [];
  for (let i = 0; i < bytes.length; i += size) {
    out.push(bytes.subarray(i, i + size));
  }
  return out;
}

/** Fraction of black dots — the D30 can fail on very dark labels (> ~60%). */
export function inkCoverage(bmp: Bitmap): number {
  let n = 0;
  for (let i = 0; i < bmp.data.length; i++) {
    n += bmp.data[i];
  }
  return n / bmp.data.length;
}
