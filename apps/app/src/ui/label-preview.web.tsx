import { bitmapToRGBA, LABEL_H, LABEL_W, renderLabel, type LabelInput } from '@mj/label';
import { useMemo } from 'react';
import { Image } from 'react-native';

/** On-screen preview of exactly what the D30 will print. */
/** Fills the available width (narrow phones), up to `maxWidth`. */
export function LabelPreview({ input, maxWidth = 320 }: { input: LabelInput; maxWidth?: number }) {
  const uri = useMemo(() => {
    const canvas = document.createElement('canvas');
    canvas.width = LABEL_W;
    canvas.height = LABEL_H;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    const bmp = renderLabel(input);
    ctx.putImageData(new ImageData(bitmapToRGBA(bmp) as Uint8ClampedArray<ArrayBuffer>, bmp.width, bmp.height), 0, 0);
    return canvas.toDataURL('image/png');
  }, [input]);
  if (!uri) return null;
  return (
    <Image
      source={{ uri }}
      accessibilityLabel="Label preview"
      style={{
        width: '100%',
        maxWidth,
        aspectRatio: LABEL_W / LABEL_H,
        borderRadius: 6,
        borderWidth: 1,
        borderColor: '#ddd',
        // @ts-expect-error web-only style keeps the pixels crisp
        imageRendering: 'pixelated',
      }}
    />
  );
}
