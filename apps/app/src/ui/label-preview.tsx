import { renderLabel, setBit, type Bitmap, type LabelInput } from '@mj/label';
import { useMemo } from 'react';
import { Image } from 'react-native';

import { toBase64 } from '@/lib/util';

import { labelStyle } from './label-style';

const HEADERS = 14 + 40 + 8; // file header + info header + 2-colour palette

/** 1-bit monochrome BMP, so native can preview the label without a canvas. */
function toBmpDataUri(bmp: Bitmap): string {
  const rowBytes = Math.ceil(bmp.width / 32) * 4; // rows padded to 4 bytes
  const dataSize = rowBytes * bmp.height;
  const buf = new Uint8Array(HEADERS + dataSize);
  const dv = new DataView(buf.buffer);
  buf.set([0x42, 0x4d]); // 'BM'
  dv.setUint32(2, buf.length, true);
  dv.setUint32(10, HEADERS, true);
  dv.setUint32(14, 40, true);
  dv.setInt32(18, bmp.width, true);
  dv.setInt32(22, bmp.height, true); // positive = bottom-up rows
  dv.setUint16(26, 1, true);
  dv.setUint16(28, 1, true); // 1 bit per pixel
  dv.setUint32(34, dataSize, true);
  dv.setUint32(46, 2, true);
  // palette: index 0 = white, index 1 = black
  buf.set([255, 255, 255, 0, 0, 0, 0, 0], 54);
  for (let y = 0; y < bmp.height; y++) {
    const row = HEADERS + (bmp.height - 1 - y) * rowBytes;
    for (let x = 0; x < bmp.width; x++) {
      if (bmp.data[y * bmp.width + x]) {
        setBit(buf, row, x);
      }
    }
  }
  return `data:image/bmp;base64,${toBase64(buf)}`;
}

/** On-screen preview of exactly what the D30 will print. */
export function LabelPreview({ number, title, url }: LabelInput) {
  const uri = useMemo(
    () => toBmpDataUri(renderLabel({ number, title, url })),
    [number, title, url],
  );
  return (
    <Image
      source={{ uri }}
      accessibilityLabel="Label preview"
      resizeMethod="scale"
      style={labelStyle}
    />
  );
}
