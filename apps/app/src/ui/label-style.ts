import { LABEL_H, LABEL_W } from '@box/label';
import type { ImageStyle } from 'react-native';

import { colors } from './theme';

/** The label preview fills the available width, up to the label's natural size. Shared by both platform previews. */
export const labelStyle: ImageStyle = {
  width: '100%',
  maxWidth: LABEL_W,
  aspectRatio: LABEL_W / LABEL_H,
  borderRadius: 6,
  borderWidth: 1,
  borderColor: colors.line,
};
