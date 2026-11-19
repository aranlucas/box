import AsyncStorage from '@react-native-async-storage/async-storage';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import type { House, User } from './api';
import { signIn as platformSignIn, signOut as platformSignOut } from './auth';
import { HOUSE_STORAGE_KEY, queries } from './queries';

export type Session =
  | { status: 'loading' }
  /** `error` is set when the server could not be asked who is signed in. */
  | { status: 'signed-out'; error?: string }
  /** `house` is the one this device is looking at; a user who has not joined a house yet has none. */
  | {
      status: 'signed-in';
      user: User;
      houses: House[];
      house?: House;
      legacyHomeClaimable: boolean;
    };

/** Who's signed in, their houses, and the house this device is currently looking at. */
export function useSession(): Session {
  const me = useQuery(queries.me());
  const saved = useQuery(queries.savedHouse());
  if (me.isPending || saved.isPending) {
    return { status: 'loading' };
  }
  if (!me.data?.user) {
    return { status: 'signed-out', error: me.error?.message };
  }
  const { user, houses, legacyHomeClaimable } = me.data;
  return {
    status: 'signed-in',
    user,
    houses,
    legacyHomeClaimable,
    house: houses.find((h) => h.id === saved.data) ?? houses[0],
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
    onSuccess: (signedIn) =>
      signedIn ? qc.invalidateQueries({ queryKey: queries.me().queryKey }) : undefined,
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
      return qc.invalidateQueries({ queryKey: queries.me().queryKey });
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
