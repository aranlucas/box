import { Platform } from 'react-native';

/**
 * Where the Worker lives. On the web build it's the same origin (empty base); the native app and
 * local dev point at the deployed Worker via EXPO_PUBLIC_API_URL.
 */
export const API_BASE = (process.env.EXPO_PUBLIC_API_URL ?? '').replace(/\/$/, '');

/** Origin printed into QR codes. Must be the deployed public origin, never localhost. */
export function publicOrigin(): string {
  if (process.env.EXPO_PUBLIC_PUBLIC_ORIGIN) return process.env.EXPO_PUBLIC_PUBLIC_ORIGIN.replace(/\/$/, '');
  if (API_BASE) return API_BASE;
  if (Platform.OS === 'web' && typeof window !== 'undefined') return window.location.origin;
  return '';
}
