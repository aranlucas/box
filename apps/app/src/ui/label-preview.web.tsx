import { bitmapToRGBA, renderLabel, type LabelInput } from '@mj/label';
import { useMemo } from 'react';
import { Image, type ImageStyle } from 'react-native';

import { labelStyle } from './label-style';

function toPngDataUri({ number, title, url }: LabelInput): string | undefined {
  const bmp = renderLabel({ number, title, url });
  const canvas = document.createElement('canvas');
  canvas.width = bmp.width;
  canvas.height = bmp.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return undefined;
  }
  ctx.putImageData(new ImageData(bitmapToRGBA(bmp), bmp.width, bmp.height), 0, 0);
  return canvas.toDataURL('image/png');
}

/** On-screen preview of exactly what the D30 will print. */
export function LabelPreview({ number, title, url }: LabelInput) {
  const uri = useMemo(() => toPngDataUri({ number, title, url }), [number, title, url]);
  return uri ? (
    <Image source={{ uri }} accessibilityLabel="Label preview" style={[labelStyle, crisp]} />
  ) : null;
}

// @ts-expect-error -- a CSS property React Native's style types don't have; keeps the label's pixels sharp when scaled up
const crisp: ImageStyle = { imageRendering: 'pixelated' };
