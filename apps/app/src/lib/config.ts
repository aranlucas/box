import { Platform } from 'react-native';

const DEFAULT_NATIVE_API_ORIGIN = 'https://bx.aranlucas.workers.dev';

/** Web uses same-origin requests by default. Native requests need an absolute URL. */
export const API_BASE =
  process.env.EXPO_PUBLIC_API_URL?.trim().replace(/\/+$/, '') ||
  (Platform.OS === 'web' ? '' : DEFAULT_NATIVE_API_ORIGIN);

/** Origin printed into QR codes. Must be the deployed public origin, never localhost. */
export function publicOrigin(): string {
  if (process.env.EXPO_PUBLIC_PUBLIC_ORIGIN) return process.env.EXPO_PUBLIC_PUBLIC_ORIGIN.replace(/\/$/, '');
  if (API_BASE) return API_BASE;
  if (Platform.OS === 'web' && typeof window !== 'undefined') return window.location.origin;
  return '';
}
