import AsyncStorage from '@react-native-async-storage/async-storage';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { type House } from './api';
import { signIn as platformSignIn, signOut as platformSignOut } from './auth';
import { HOUSE_STORAGE_KEY, queries } from './queries';

/** Who's signed in, their houses, and the house this device is currently looking at. */
export function useSession() {
  const me = useQuery(queries.me());
  const saved = useQuery(queries.savedHouse());
  const houses = me.data?.houses ?? [];
  const house: House | null = houses.find((h) => h.id === saved.data) ?? houses.at(0) ?? null;
  return {
    me: me.data ?? null,
    house,
    loading: me.isPending || saved.isPending,
    error: me.error ? me.error.message : null,
  };
}

export function useSetHouse() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await AsyncStorage.setItem(HOUSE_STORAGE_KEY, id).catch(() => {});
      return id;
    },
    onSuccess: (id) => qc.setQueryData(queries.savedHouse().queryKey, id),
  });
}

export function useSignIn() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (returnTo?: string) => platformSignIn(returnTo),
    onSuccess: (ok) => {
      if (ok) {
        void qc.invalidateQueries({ queryKey: queries.me().queryKey });
      }
    },
  });
}

export function useSignOut() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      await platformSignOut();
      await AsyncStorage.removeItem(HOUSE_STORAGE_KEY).catch(() => {});
    },
    onSuccess: () => {
      qc.clear();
      qc.setQueryData(queries.me().queryKey, {
        user: null,
        houses: [],
        legacyHomeClaimable: false,
      });
      void qc.invalidateQueries({ queryKey: queries.me().queryKey });
    },
  });
}

/** After joining/claiming/creating a house: refresh houses and switch to it. */
export function useEnterHouse() {
  const qc = useQueryClient();
  const setHouse = useSetHouse();
  return async (house: House) => {
    await qc.invalidateQueries({ queryKey: queries.me().queryKey });
    await setHouse.mutateAsync(house.id);
  };
}
