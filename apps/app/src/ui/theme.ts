import type { ViewStyle } from 'react-native';

export const colors = {
  bg: '#F3EDE3', // warm paper
  card: '#FFFFFF',
  ink: '#1D1A16',
  muted: '#6F665B',
  line: '#E2D9CB',
  kraft: '#B9773A', // cardboard accent
  kraftDark: '#8E5523',
  kraftSoft: '#F1E2CF',
  green: '#2F7A4B',
  greenSoft: '#DDEFE3',
  red: '#B3261E',
  redSoft: '#F9DEDC',
};

export const radius = { sm: 8, md: 12, lg: 18 };
export const space = (n: number) => n * 4;
const MAX_WIDTH = 640;

/**
 * The centred page column every screen lines up on: page body, list rows, footer and web header.
 * It centres with auto margins rather than alignSelf because on web some of its parents (LegendList's
 * header and row wrappers) are plain block <div>s, where alignSelf does nothing.
 */
export const pageColumn = {
  width: '100%',
  maxWidth: MAX_WIDTH,
  marginHorizontal: 'auto',
  paddingHorizontal: space(4),
} satisfies ViewStyle;
/** Smallest comfortable tap target (Android asks for 48dp, iOS for 44pt). */
export const TAP = 44;
