import qrcode from 'qrcode-generator';
import { createBitmap, drawText, fillRect, textHeight, textWidth, type Bitmap } from './bitmap';
import { normalizeText } from './font';

/** 40 x 12 mm label at 8 dots/mm, landscape (as read). */
export const LABEL_W = 320;
export const LABEL_H = 96;

export type LabelInput = {
  number: number;
  title: string;
  url: string;
};

const QR_AREA = LABEL_H; // square region on the left
const QR_QUIET_MODULES = 4;
const TEXT_X = QR_AREA;
const TEXT_MAX_W = LABEL_W - TEXT_X - 4;
const NUMBER_SCALE = 5;
const BIG_TITLE_SCALE = 4; // one line, short titles
const TITLE_SCALE = 3; // up to two lines
const LINE_GAP = 4;
const BLOCK_GAP = 7;
const MARGIN_Y = 2;

const maxChars = (scale: number) => {
  let n = 0;
  while (textWidth(n + 1, scale) <= TEXT_MAX_W) {
    n++;
  }
  return n;
};

export type TitleLayout = {
  lines: string[];
  fits: boolean;
  scale: number;
};

/** How the title will be laid out on the label. `fits` is false when it had to be truncated. */
export function titleLayout(title: string): TitleLayout {
  const t = normalizeText(title);
  if (!t) {
    return { lines: [], fits: true, scale: TITLE_SCALE };
  }
  if (t.length <= maxChars(BIG_TITLE_SCALE)) {
    return { lines: [t], fits: true, scale: BIG_TITLE_SCALE };
  }

  const max = maxChars(TITLE_SCALE);
  const lines: string[] = [];
  let cur = '';
  for (let word of t.split(' ')) {
    while (word.length > max) {
      // hard-break very long words
      if (cur) {
        lines.push(cur);
        cur = '';
      }
      lines.push(word.slice(0, max));
      word = word.slice(max);
    }
    if (!word) {
      continue;
    }
    if (!cur) {
      cur = word;
    } else if (cur.length + 1 + word.length <= max) {
      cur += ` ${word}`;
    } else {
      lines.push(cur);
      cur = word;
    }
  }
  if (cur) {
    lines.push(cur);
  }

  const [first, second, ...overflow] = lines;
  if (first === undefined || second === undefined || overflow.length === 0) {
    return { lines, fits: true, scale: TITLE_SCALE };
  }
  // Leave room for the ellipsis that says there was more.
  return { lines: [first, `${second.slice(0, max - 1)}…`], fits: false, scale: TITLE_SCALE };
}

const ALNUM = /^[0-9A-Z $%*+\-./:]*$/;

function makeQr(url: string) {
  const data = url.toUpperCase();
  const mode = ALNUM.test(data) ? 'Alphanumeric' : 'Byte';
  let best: { q: ReturnType<typeof qrcode>; cell: number } | undefined;

  // Keep modules as large as possible. Increase correction while the same dot size still fits.
  for (const ec of ['L', 'M', 'Q', 'H'] as const) {
    const q = qrcode(0, ec);
    q.addData(data, mode);
    q.make();
    const modulesWithQuietZone = q.getModuleCount() + 2 * QR_QUIET_MODULES;
    const cell = Math.floor(QR_AREA / modulesWithQuietZone);
    if (cell < 1 || (best && cell < best.cell)) {
      break;
    }
    best = { q, cell };
  }

  if (!best) {
    throw new Error('The URL is too long to fit a QR code on the label.');
  }
  return best;
}

export function drawQr(b: Bitmap, url: string): void {
  const { q, cell } = makeQr(url);
  const n = q.getModuleCount();
  const size = n * cell;
  const x0 = Math.floor((QR_AREA - size) / 2);
  const y0 = Math.floor((LABEL_H - size) / 2);
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (q.isDark(r, c)) {
        fillRect(b, x0 + c * cell, y0 + r * cell, cell, cell);
      }
    }
  }
}

export function renderLabel(input: LabelInput): Bitmap {
  const b = createBitmap(LABEL_W, LABEL_H);
  if (input.url) {
    drawQr(b, input.url);
  }

  const num = `#${input.number}`;
  let numScale = NUMBER_SCALE;
  while (numScale > 2 && textWidth(num.length, numScale) > TEXT_MAX_W) {
    numScale--;
  }

  const layout = titleLayout(input.title);
  const lineCount = layout.lines.length;
  const titleH =
    lineCount > 0
      ? BLOCK_GAP + lineCount * textHeight(layout.scale) + (lineCount - 1) * LINE_GAP
      : 0;
  const blockH = textHeight(numScale) + titleH;
  let y = Math.max(MARGIN_Y, Math.round((LABEL_H - blockH) / 2));

  drawText(b, num, TEXT_X, y, numScale);
  y += textHeight(numScale) + BLOCK_GAP;
  for (const line of layout.lines) {
    drawText(b, line, TEXT_X, y, layout.scale);
    y += textHeight(layout.scale) + LINE_GAP;
  }
  return b;
}
