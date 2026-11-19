import AsyncStorage from '@react-native-async-storage/async-storage';
import { createMMKV, type MMKV } from 'react-native-mmkv';

export const preferenceKeys = {
  deviceId: 'device-id',
  houseId: 'house-id',
  printerId: 'printer-device-id',
} as const;

type PreferenceKey = (typeof preferenceKeys)[keyof typeof preferenceKeys];
const MIGRATED = 'async-storage-migrated';
let storage: MMKV | undefined;
let migration: Promise<void> | undefined;

async function loadPreferences() {
  storage ??= createMMKV({ id: 'boxes.preferences' });
  const store = storage;
  if (!store.getBoolean(MIGRATED)) {
    migration ??= migratePreferences(store).finally(() => {
      migration = undefined;
    });
    await migration;
  }
  return store;
}

async function migratePreferences(store: MMKV) {
  const keys = Object.values(preferenceKeys);
  const old = await AsyncStorage.multiGet(keys);
  if (store.getBoolean(MIGRATED)) {
    return;
  }
  // Keep values copied by a previous attempt if it failed before marking migration complete.
  for (const [key, value] of old) {
    if (value !== null && !store.contains(key)) {
      store.set(key, value);
    }
  }
  await AsyncStorage.multiRemove(keys);
  store.set(MIGRATED, true);
}

export const preferences = {
  async getItem(key: PreferenceKey) {
    return (await loadPreferences()).getString(key) ?? null;
  },
  async setItem(key: PreferenceKey, value: string) {
    (await loadPreferences()).set(key, value);
  },
  async removeItem(key: PreferenceKey) {
    (await loadPreferences()).remove(key);
  },
};
