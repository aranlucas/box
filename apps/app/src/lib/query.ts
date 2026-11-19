import { focusManager, QueryClient } from '@tanstack/react-query';
import { AppState, Platform } from 'react-native';

import { ApiError } from './api';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      // Don't hammer the API on 4xx (signed out, not found, forbidden); retry transient failures.
      retry: (count, err) => !(err instanceof ApiError && err.status >= 400 && err.status < 500) && count < 2,
    },
  },
});

// Native: treat app foregrounding as "window focus" so stale queries refetch.
if (Platform.OS !== 'web') {
  focusManager.setEventListener((setFocused) => {
    const sub = AppState.addEventListener('change', (s) => setFocused(s === 'active'));
    return () => sub.remove();
  });
}
