import AsyncStorage from '@react-native-async-storage/async-storage';
import { queryOptions } from '@tanstack/react-query';

import { api } from './api';
import { tryReconnect } from './printer';

export const HOUSE_STORAGE_KEY = 'house-id';
export const houseBoxesKey = (houseId: string) => ['boxes', houseId] as const;

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

  members: (houseId: string | undefined) =>
    queryOptions({
      queryKey: ['members', houseId],
      queryFn: () => api.members(houseId!),
      enabled: !!houseId,
    }),

  /** Household key saved by the pre-sign-in web app (v1), used to pre-fill the claim form. */
  legacyKey: () =>
    queryOptions({
      queryKey: ['legacy-household-key'],
      queryFn: () => AsyncStorage.getItem('household-key').catch(() => null),
      staleTime: Infinity,
      networkMode: 'always',
    }),

  invite: (token: string) => queryOptions({ queryKey: ['invite', token], queryFn: () => api.inviteInfo(token) }),

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
