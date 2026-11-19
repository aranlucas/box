import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useSyncExternalStore } from 'react';

import { api, setApiHouse, type House, type Me } from './api';
import { signIn as platformSignIn, signOut as platformSignOut } from './auth';

const HOUSE_KEY = 'house-id';

type State = { me: Me | null; loading: boolean; error: string | null; house: House | null };
let state: State = { me: null, loading: true, error: null, house: null };
const listeners = new Set<() => void>();
let inflight: Promise<void> | null = null;

function set(next: Partial<State>) {
  state = { ...state, ...next };
  setApiHouse(state.house?.id ?? null);
  listeners.forEach((l) => l());
}

async function load() {
  try {
    const me = await api.me();
    const saved = await AsyncStorage.getItem(HOUSE_KEY).catch(() => null);
    const house = me.houses.find((h) => h.id === saved) ?? me.houses[0] ?? null;
    set({ me, house, loading: false, error: null });
  } catch (e) {
    set({ loading: false, error: e instanceof Error ? e.message : String(e) });
  }
}

/** Reload who's signed in and their houses. */
export function refreshSession(): Promise<void> {
  inflight ??= load().finally(() => (inflight = null));
  return inflight;
}

export async function setHouse(id: string) {
  const house = state.me?.houses.find((h) => h.id === id) ?? null;
  if (!house) return;
  await AsyncStorage.setItem(HOUSE_KEY, id).catch(() => {});
  set({ house });
}

export async function signIn(returnTo?: string) {
  const ok = await platformSignIn(returnTo);
  if (ok) await refreshSession();
  return ok;
}

export async function signOut() {
  await platformSignOut();
  await AsyncStorage.removeItem(HOUSE_KEY).catch(() => {});
  set({ me: { user: null, houses: [], legacyHomeClaimable: false }, house: null });
  await refreshSession();
}

export function useSession(): State {
  const snap = useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => state,
    () => state,
  );
  useEffect(() => {
    if (!state.me && !inflight) refreshSession();
  }, []);
  return snap;
}
