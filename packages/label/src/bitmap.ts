import { FONT, GLYPH_H, GLYPH_W } from './font';

/** 1 byte per pixel, 1 = black. */
export interface Bitmap {
  width: number;
  height: number;
  data: Uint8Array;
}

export function createBitmap(width: number, height: number): Bitmap {
  return { width, height, data: new Uint8Array(width * height) };
}

export function fillRect(b: Bitmap, x: number, y: number, w: number, h: number, v = 1): void {
  const x0 = Math.max(0, x), y0 = Math.max(0, y);
  const x1 = Math.min(b.width, x + w), y1 = Math.min(b.height, y + h);
  for (let yy = y0; yy < y1; yy++) b.data.fill(v, yy * b.width + x0, yy * b.width + x1);
}

/** Advance in dots for one character at scale s (glyph + 1 cell spacing). */
export const charAdvance = (s: number) => (GLYPH_W + 1) * s;
/** Rendered width of n characters at scale s (no trailing spacing). */
export const textWidth = (n: number, s: number) => (n <= 0 ? 0 : n * charAdvance(s) - s);
export const textHeight = (s: number) => GLYPH_H * s;

/** Draw already-normalized text at (x, y) with integer scale. */
export function drawText(b: Bitmap, text: string, x: number, y: number, scale: number): void {
  let cx = x;
  for (const ch of text) {
    const g = FONT[ch] ?? FONT['?'];
    for (let r = 0; r < GLYPH_H; r++) {
      const row = g[r];
      for (let c = 0; c < GLYPH_W; c++) {
        if (row & (1 << (GLYPH_W - 1 - c))) fillRect(b, cx + c * scale, y + r * scale, scale, scale);
      }
    }
    cx += charAdvance(scale);
  }
}

export function bitmapToAscii(bmp: Bitmap): string {
  const lines: string[] = [];
  for (let y = 0; y < bmp.height; y++) {
    let s = '';
    for (let x = 0; x < bmp.width; x++) s += bmp.data[y * bmp.width + x] ? '#' : '.';
    lines.push(s);
  }
  return lines.join('\n');
}

/** RGBA pixels (black ink on white) for an ImageData preview. */
export function bitmapToRGBA(bmp: Bitmap): Uint8ClampedArray {
  const out = new Uint8ClampedArray(bmp.width * bmp.height * 4);
  for (let i = 0; i < bmp.data.length; i++) {
    const v = bmp.data[i] ? 0 : 255;
    out[i * 4] = v;
    out[i * 4 + 1] = v;
    out[i * 4 + 2] = v;
    out[i * 4 + 3] = 255;
  }
  return out;
}
