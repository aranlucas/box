import AsyncStorage from '@react-native-async-storage/async-storage';
import { beforeEach, expect, test, vi } from 'vitest';

const records = vi.hoisted(() => new Map<string, string | boolean>());
const previous = vi.hoisted(() => new Map<string, string>());

vi.mock('react-native-mmkv', () => ({
  createMMKV: () => ({
    getBoolean: (key: string) => records.get(key),
    getString: (key: string) => records.get(key),
    contains: (key: string) => records.has(key),
    set: (key: string, value: string | boolean) => records.set(key, value),
    remove: (key: string) => records.delete(key),
  }),
}));

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    multiGet: vi.fn(async (keys: string[]) => keys.map((key) => [key, previous.get(key) ?? null])),
    multiRemove: vi.fn(async (keys: string[]) => {
      for (const key of keys) {
        previous.delete(key);
      }
    }),
  },
}));

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  records.clear();
  previous.clear();
});

test('moves existing preferences once and serializes requests behind the migration', async () => {
  const { preferenceKeys, preferences } = await import('../src/lib/preferences');
  previous.set(preferenceKeys.houseId, 'house-a');
  previous.set(preferenceKeys.legacyHouseholdKey, 'legacy-key');
  previous.set(preferenceKeys.printerId, 'printer-a');
  previous.set(preferenceKeys.deviceId, 'device-a');
  previous.set('unrelated-key', 'keep');
  const [deviceId, printerId] = await Promise.all([
    preferences.getItem(preferenceKeys.deviceId),
    preferences.getItem(preferenceKeys.printerId),
    preferences.removeItem(preferenceKeys.houseId),
  ]);

  expect(deviceId).toBe('device-a');
  expect(printerId).toBe('printer-a');
  expect(await preferences.getItem(preferenceKeys.houseId)).toBeNull();
  expect(await preferences.getItem(preferenceKeys.legacyHouseholdKey)).toBe('legacy-key');
  expect([...previous.keys()]).toEqual(['unrelated-key']);

  vi.resetModules();
  const restarted = await import('../src/lib/preferences');
  expect(await restarted.preferences.getItem(preferenceKeys.houseId)).toBeNull();
  expect(AsyncStorage.multiGet).toHaveBeenCalledTimes(1);
});

test('retries an interrupted migration without overwriting a copied value', async () => {
  const { preferenceKeys, preferences } = await import('../src/lib/preferences');
  previous.set(preferenceKeys.houseId, 'house-a');
  vi.mocked(AsyncStorage.multiRemove).mockRejectedValueOnce(new Error('storage unavailable'));

  await expect(preferences.getItem(preferenceKeys.houseId)).rejects.toThrow('storage unavailable');
  expect(previous.get(preferenceKeys.houseId)).toBe('house-a');
  expect(records.get(preferenceKeys.houseId)).toBe('house-a');
  previous.set(preferenceKeys.houseId, 'house-b');

  expect(await preferences.getItem(preferenceKeys.houseId)).toBe('house-a');
  await preferences.setItem(preferenceKeys.houseId, 'house-c');
  expect(await preferences.getItem(preferenceKeys.houseId)).toBe('house-c');
});
