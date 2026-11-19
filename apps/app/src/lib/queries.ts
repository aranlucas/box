import AsyncStorage from '@react-native-async-storage/async-storage';
import { keepPreviousData, queryOptions } from '@tanstack/react-query';

import { api } from './api';
import { tryReconnect } from './printer';

export const HOUSE_STORAGE_KEY = 'house-id';

/** Every query in the app is defined here with queryOptions(), so keys and data types stay in sync. */
export const queries = {
  me: () => queryOptions({ queryKey: ['me'], queryFn: api.me }),

  savedHouse: () =>
    queryOptions({
      queryKey: ['saved-house'],
      queryFn: () => AsyncStorage.getItem(HOUSE_STORAGE_KEY).catch(() => null),
      staleTime: Infinity,
    }),

  /** Prefix for invalidating every box list. */
  allBoxes: () => ['boxes'] as const,
  boxes: (houseId: string, q: string) =>
    queryOptions({
      queryKey: ['boxes', houseId, q],
      queryFn: () => api.listBoxes(houseId, q),
      placeholderData: keepPreviousData,
    }),

  box: (id: string) => queryOptions({ queryKey: ['box', id], queryFn: () => api.getBox(id) }),

  members: (houseId: string | undefined) =>
    queryOptions({
      queryKey: ['members', houseId],
      queryFn: () => api.members(houseId!),
      enabled: !!houseId,
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
      retry: false,
      refetchOnWindowFocus: false,
    }),
};
