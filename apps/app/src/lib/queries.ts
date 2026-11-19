import AsyncStorage from '@react-native-async-storage/async-storage';
import { queryOptions } from '@tanstack/react-query';

import { api } from './api';
import { getDeviceId } from './device';
import { tryReconnect } from './printer';

export const HOUSE_STORAGE_KEY = 'house-id';
export const houseBoxesKey = (houseId: string) => ['boxes', houseId] as const;
/** How often a screen showing the house's printers asks again. */
export const PRINTERS_POLL_MS = 5000;

export const queries = {
  me: () => queryOptions({ queryKey: ['me'], queryFn: api.me }),

  savedHouse: () =>
    queryOptions({
      queryKey: ['saved-house'],
      queryFn: () => AsyncStorage.getItem(HOUSE_STORAGE_KEY).catch(() => null),
      staleTime: Infinity,
      networkMode: 'always',
    }),

  boxSearch: (houseId: string, userId: string, q: string) =>
    queryOptions({
      queryKey: [...houseBoxesKey(houseId), userId, 'search', q],
      queryFn: ({ signal }) => api.listBoxes(houseId, q, signal),
      enabled: q.length > 0,
    }),

  box: (id: string) => queryOptions({ queryKey: ['box', id], queryFn: () => api.getBox(id) }),

  members: (houseId: string) =>
    queryOptions({ queryKey: ['members', houseId], queryFn: () => api.members(houseId) }),

  /** Household key saved by the pre-sign-in web app (v1), used to pre-fill the claim form. */
  legacyKey: () =>
    queryOptions({
      queryKey: ['legacy-household-key'],
      queryFn: () => AsyncStorage.getItem('household-key').catch(() => null),
      staleTime: Infinity,
      networkMode: 'always',
    }),

  /** This install's id in the house's printer table. */
  deviceId: () =>
    queryOptions({
      queryKey: ['device-id'],
      queryFn: getDeviceId,
      staleTime: Infinity,
      gcTime: Infinity,
      networkMode: 'always',
    }),

  /** The house's connection status table: every device in it that can print right now. Polled while shown. */
  printers: (houseId: string) =>
    queryOptions({
      queryKey: ['printers', houseId],
      queryFn: () => api.listPrinters(houseId),
      staleTime: 0,
      refetchInterval: PRINTERS_POLL_MS,
    }),

  invite: (token: string) =>
    queryOptions({ queryKey: ['invite', token], queryFn: () => api.inviteInfo(token) }),

  /** Silently reconnect to the last-used printer once per app session (shared across screens). */
  printerReconnect: () =>
    queryOptions({
      queryKey: ['printer', 'reconnect'],
      queryFn: async () => {
        await tryReconnect();
        return true;
      },
      staleTime: Infinity,
      gcTime: Infinity,
      networkMode: 'always',
      retry: false,
      refetchOnWindowFocus: false,
    }),
};
