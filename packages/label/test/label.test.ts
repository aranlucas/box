import { describe, expect, it } from 'vitest';
import {
  LABEL_H, LABEL_W, bitmapToAscii, bitmapToRGBA, buildJob, chunks, encodeD30, inkCoverage, renderLabel, titleLayout,
  type Bitmap,
} from '../src/index';

const blank = (): Bitmap => ({ width: LABEL_W, height: LABEL_H, data: new Uint8Array(LABEL_W * LABEL_H) });
const hex = (u: Uint8Array) => [...u].map((b) => b.toString(16).padStart(2, '0')).join(' ');

describe('encodeD30', () => {
  it('writes the ESC/POS raster header and footer', () => {
    const job = encodeD30(blank());
    expect(hex(job.header)).toBe('1b 40 1d 76 30 00 0c 00 40 01');
    expect(hex(job.footer)).toBe('1b 64 00');
    expect(job.data.length).toBe(12 * 320);
    expect(job.header.length + job.data.length + job.footer.length).toBe(3853);
  });

  it('rotates clockwise: design (0,0) -> row 0, byte 11 = 0x01', () => {
    const b = blank();
    b.data[0] = 1;
    const { data } = encodeD30(b, 'cw');
    expect(data[11]).toBe(0x01);
    expect(data.reduce((a, v) => a + v, 0)).toBe(1);
  });

  it('rotates counter-clockwise: design (0,0) -> row 319, byte 0 = 0x80', () => {
    const b = blank();
    b.data[0] = 1;
    const { data } = encodeD30(b, 'ccw');
    expect(data[319 * 12]).toBe(0x80);
    expect(data.reduce((a, v) => a + v, 0)).toBe(0x80);
  });

  it('cw maps design bottom-right to the last row, first dot', () => {
    const b = blank();
    b.data[LABEL_W * LABEL_H - 1] = 1; // (319, 95)
    const { data } = encodeD30(b, 'cw');
    expect(data[319 * 12]).toBe(0x80);
  });
});

describe('chunks', () => {
  it('splits into fixed-size pieces with a short tail', () => {
    const parts = chunks(new Uint8Array(3840), 128);
    expect(parts.length).toBe(30);
    expect(parts.every((p) => p.length === 128)).toBe(true);
    const odd = chunks(new Uint8Array(300), 128);
    expect(odd.map((p) => p.length)).toEqual([128, 128, 44]);
  });
  it('rejects non-positive sizes', () => expect(() => chunks(new Uint8Array(4), 0)).toThrow());
});

describe('titleLayout', () => {
  it('uses one big line for short titles', () => {
    expect(titleLayout('Books')).toEqual({ lines: ['BOOKS'], fits: true, scale: 4 });
  });
  it('wraps longer titles onto two lines', () => {
    const l = titleLayout('Kitchen glassware');
    expect(l.lines).toEqual(['KITCHEN', 'GLASSWARE']);
    expect(l.fits).toBe(true);
    expect(l.scale).toBe(3);
  });
  it('truncates titles that need more than two lines', () => {
    const l = titleLayout('Bathroom towels sheets and assorted linens');
    expect(l.lines.length).toBe(2);
    expect(l.fits).toBe(false);
    expect(l.lines[1].endsWith('…')).toBe(true);
    expect(l.lines.every((s) => s.length <= 12)).toBe(true);
  });
  it('normalizes accents and unknown chars', () => {
    expect(titleLayout('Café_mugs')).toMatchObject({ lines: ['CAFE-MUGS'] });
  });
});

describe('renderLabel', () => {
  const input = { number: 14, title: 'Kitchen glassware', url: 'https://bx.example.workers.dev/b/K7Q2M9P4' };

  it('renders a 320x96 label with QR + text and modest ink coverage', () => {
    const bmp = renderLabel(input);
    expect(bmp.width).toBe(320);
    expect(bmp.height).toBe(96);
    const cov = inkCoverage(bmp);
    expect(cov).toBeGreaterThan(0.1);
    expect(cov).toBeLessThan(0.45);
  });

  it.each([
    ['https://bx.aranlucas.workers.dev/b/K7Q2M9P4', 2, 33],
    ['https://moving-journey.example.workers.dev/b/K7Q2M9P4', 2, 37],
    ['https://bx.co/b/K7Q2M9P4', 3, 21],
  ])('leaves a four-module quiet zone around %s', (url, dotsPerModule, modules) => {
    const bmp = renderLabel({ ...input, url });
    const firstDot = bmp.data.findIndex((dot, i) => dot === 1 && i % bmp.width < LABEL_H);
    const top = Math.floor(firstDot / bmp.width);
    const left = firstDot % bmp.width;
    const topRow = bmp.data.subarray(top * bmp.width, top * bmp.width + LABEL_H);
    const right = topRow.lastIndexOf(1) + 1;
    const bottom = top + right - left;

    // The top edge of the finder pattern is seven modules wide.
    const cell = (topRow.indexOf(0, left) - left) / 7;
    const quiet = cell * 4;
    expect(Math.min(top, left, bmp.height - bottom, LABEL_H - right)).toBeGreaterThanOrEqual(quiet);
    for (let y = top - quiet; y < bottom + quiet; y++) {
      const row = y * bmp.width;
      const hasInk = (from: number, to: number) => bmp.data.subarray(row + from, row + to).includes(1);
      if (y < top || y >= bottom) {
        expect(hasInk(left - quiet, right + quiet)).toBe(false);
      } else {
        expect(hasInk(left - quiet, left)).toBe(false);
        expect(hasInk(right, right + quiet)).toBe(false);
      }
    }
    expect(cell).toBe(dotsPerModule);
    expect(right - left).toBe(dotsPerModule * modules);
  });

  it('keeps the label edges clear', () => {
    const bmp = renderLabel(input);
    for (const y of [0, 1, 94, 95]) for (let x = 0; x < 320; x++) expect(bmp.data[y * 320 + x]).toBe(0);
  });

  it('is deterministic', () => {
    expect(bitmapToAscii(renderLabel(input))).toBe(bitmapToAscii(renderLabel(input)));
  });

  it('builds a complete job', () => {
    const job = buildJob(input);
    expect(job.data.length).toBe(3840);
  });

  it('converts to RGBA', () => {
    const rgba = bitmapToRGBA(renderLabel(input));
    expect(rgba.length).toBe(320 * 96 * 4);
  });
});
