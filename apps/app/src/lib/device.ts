import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Device from 'expo-device';

const ID_KEY = 'device-id';
let cachedId: Promise<string> | null = null;

/** A stable, random id for this install. Identifies the device in the household's printer table. */
export function getDeviceId(): Promise<string> {
  cachedId ??= (async () => {
    const existing = await AsyncStorage.getItem(ID_KEY).catch(() => null);
    if (existing) {
      return existing;
    }
    const id = Array.from({ length: 16 }, () => Math.floor(Math.random() * 36).toString(36)).join(
      '',
    );
    await AsyncStorage.setItem(ID_KEY, id).catch(() => {});
    return id;
  })();
  return cachedId;
}

/** What other household devices see, e.g. "Sam's Pixel 8" (native) or "Android" / "Mac" (web). */
export function deviceName(): string {
  return Device.deviceName ?? Device.modelName ?? Device.osName ?? 'Another device';
}
