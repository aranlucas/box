import AsyncStorage from '@react-native-async-storage/async-storage';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api, type House, type Me } from './api';
import { signIn as platformSignIn, signOut as platformSignOut } from './auth';
import { keys } from './query';

const HOUSE_KEY = 'house-id';

/** Who's signed in, their houses, and the house this device is currently looking at. */
export function useSession() {
  const me = useQuery({ queryKey: keys.me, queryFn: api.me });
  const saved = useQuery({
    queryKey: keys.savedHouse,
    queryFn: () => AsyncStorage.getItem(HOUSE_KEY).catch(() => null),
    staleTime: Infinity,
  });
  const houses = me.data?.houses ?? [];
  const house: House | null = houses.find((h) => h.id === saved.data) ?? houses[0] ?? null;
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
      await AsyncStorage.setItem(HOUSE_KEY, id).catch(() => {});
      return id;
    },
    onSuccess: (id) => qc.setQueryData(keys.savedHouse, id),
  });
}

export function useSignIn() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (returnTo?: string) => platformSignIn(returnTo),
    onSuccess: (ok) => {
      if (ok) qc.invalidateQueries({ queryKey: keys.me });
    },
  });
}

export function useSignOut() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      await platformSignOut();
      await AsyncStorage.removeItem(HOUSE_KEY).catch(() => {});
    },
    onSuccess: () => {
      qc.clear();
      qc.setQueryData<Me>(keys.me, { user: null, houses: [], legacyHomeClaimable: false });
      qc.invalidateQueries({ queryKey: keys.me });
    },
  });
}

/** After joining/claiming/creating a house: refresh houses and switch to it. */
export function useEnterHouse() {
  const qc = useQueryClient();
  const setHouse = useSetHouse();
  return async (house: House) => {
    await qc.invalidateQueries({ queryKey: keys.me });
    await setHouse.mutateAsync(house.id);
  };
}
