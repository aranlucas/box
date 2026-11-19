import { QueryObserver } from '@tanstack/query-core';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { expect, test, vi } from 'vitest';

import { api } from '../src/lib/api';
import { queryClient } from '../src/lib/query';

vi.mock('../src/lib/preferences', () => ({ preferenceKeys: {}, preferences: {} }));
vi.mock('expo-keep-awake', () => ({
  activateKeepAwakeAsync: vi.fn().mockResolvedValue(undefined),
  deactivateKeepAwake: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../src/lib/api', () => ({
  api: { printerOffline: vi.fn().mockResolvedValue(undefined) },
}));
vi.mock('../src/lib/device', () => ({
  getDeviceId: vi.fn().mockResolvedValue('device'),
}));
vi.mock('../src/lib/printer', () => ({}));
vi.mock('../src/lib/query', async () => {
  const { QueryClient } = await import('@tanstack/query-core');
  return { queryClient: new QueryClient() };
});

test('keeps the device awake after the first successful heartbeat and unregisters when sharing ends', async () => {
  await import('../src/lib/household');
  const heartbeat = new QueryObserver(queryClient, {
    queryKey: ['printer-heartbeat', 'H1'],
    queryFn: async () => 0,
    gcTime: 0,
  });
  const unsubscribe = heartbeat.subscribe(() => {});
  try {
    await vi.waitFor(() => expect(activateKeepAwakeAsync).toHaveBeenCalledTimes(1));
    await heartbeat.refetch();
    expect(activateKeepAwakeAsync).toHaveBeenCalledTimes(1);
    expect(api.printerOffline).not.toHaveBeenCalled();
  } finally {
    unsubscribe();
    queryClient.clear();
  }
  expect(deactivateKeepAwake).toHaveBeenCalledTimes(1);
  await vi.waitFor(() => expect(api.printerOffline).toHaveBeenCalledWith('H1', 'device'));
});
