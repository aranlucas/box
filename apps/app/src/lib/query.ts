import { DbClient } from '@tanstack/react-db';
import { focusManager, onlineManager, QueryClient } from '@tanstack/react-query';
import { addNetworkStateListener, getNetworkStateAsync } from 'expo-network';
import { AppState, Platform } from 'react-native';

import { ApiError } from './api';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      // Don't hammer the API on 4xx (signed out, not found, forbidden); retry transient failures.
      retry: (count, err) =>
        !(err instanceof ApiError && err.status >= 400 && err.status < 500) && count < 2,
    },
    // Preserve immediate execution for local actions and user-initiated writes.
    mutations: { networkMode: 'always' },
  },
});

export const dbClient = new DbClient({ queryClient });

// Native: treat app foregrounding as "window focus" so stale queries refetch.
if (Platform.OS !== 'web') {
  focusManager.setEventListener((setFocused) => {
    const sub = AppState.addEventListener('change', (s) => setFocused(s === 'active'));
    return () => sub.remove();
  });

  onlineManager.setEventListener((setOnline) => {
    let receivedEvent = false;
    let disposed = false;
    const subscription = addNetworkStateListener(({ isConnected }) => {
      receivedEvent = true;
      if (isConnected !== undefined) {
        setOnline(isConnected);
      }
    });
    async function readInitialState() {
      const state = await getNetworkStateAsync().catch(() => undefined);
      if (!disposed && !receivedEvent && state?.isConnected !== undefined) {
        setOnline(state.isConnected);
      }
    }
    void readInitialState();
    return () => {
      disposed = true;
      subscription.remove();
    };
  });
}
