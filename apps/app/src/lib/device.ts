import * as Device from 'expo-device';

import { preferenceKeys, preferences } from './preferences';

let cachedId: Promise<string> | undefined;

/** A stable, random id for this install. Identifies the device in the household's printer table. */
export function getDeviceId(): Promise<string> {
  cachedId ??= (async () => {
    const existing = await preferences.getItem(preferenceKeys.deviceId);
    if (existing) {
      return existing;
    }
    const id = Array.from({ length: 16 }, () => Math.floor(Math.random() * 36).toString(36)).join(
      '',
    );
    await preferences.setItem(preferenceKeys.deviceId, id);
    return id;
  })().catch((error: unknown) => {
    cachedId = undefined;
    throw error;
  });
  return cachedId;
}

/** What other household devices see, e.g. "Sam's Pixel 8" (native) or "Android" / "Mac" (web). */
export function deviceName(): string {
  return Device.deviceName ?? Device.modelName ?? Device.osName ?? 'Another device';
}
