import { createLiveQueryCollection, DbClient } from '@tanstack/react-db';
import { QueryClient } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { api, type BoxSummary } from '../src/lib/api';
import { boxInventory, refreshHouseBoxes } from '../src/lib/boxes';
import { queries } from '../src/lib/queries';

vi.mock('@react-native-async-storage/async-storage', () => ({ default: {} }));
vi.mock('../src/lib/api', () => ({ api: { listBoxes: vi.fn() } }));
vi.mock('../src/lib/printer', () => ({ tryReconnect: vi.fn() }));

function summary(houseId: string, number: number): BoxSummary {
  return {
    id: `${houseId}-${number}`,
    house_id: houseId,
    number,
    title: `Box ${number}`,
    room: null,
    notes: null,
    status: 'packed',
    created_at: 1,
    updated_at: 1,
    item_count: 0,
    preview: null,
  };
}

describe('box inventory', () => {
  let queryClient: QueryClient;
  let db: DbClient;
  const listBoxes = vi.mocked(api.listBoxes);

  beforeEach(() => {
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
    db = new DbClient({ queryClient });
    listBoxes.mockReset();
  });

  afterEach(async () => {
    await db.cleanup();
    queryClient.clear();
  });

  test('sorts live rows by box number and scopes refreshes to the affected house', async () => {
    const first = summary('H1', 1);
    const second = summary('H1', 2);
    const otherHouse = summary('H2', 1);
    listBoxes.mockImplementation(async (houseId) => houseId === 'H1' ? [first, second] : [otherHouse]);

    const source = db.collection(boxInventory('H1', 'U1'));
    expect(db.collection(boxInventory('H1', 'U1'))).toBe(source);
    expect(db.collection(boxInventory('H1', 'U2'))).not.toBe(source);

    const live = createLiveQueryCollection((q) => q.from({ box: source }).orderBy(({ box }) => box.number, 'desc'));
    const subscription = live.subscribeChanges(() => {});
    try {
      await live.preload();
      await db.collection(boxInventory('H2', 'U1')).preload();
      expect(live.toArray.map((box) => box.id)).toEqual([second.id, first.id]);
      expect(await queryClient.fetchQuery(queries.boxSearch('H1', 'U1', 'supplies'))).toEqual([first, second]);
      listBoxes.mockClear();
      listBoxes.mockResolvedValue([{ ...first, status: 'unpacked' }]);

      await refreshHouseBoxes(queryClient, 'H1');

      await vi.waitFor(() => expect(live.toArray.map((box) => [box.id, box.status])).toEqual([[first.id, 'unpacked']]));
      expect(listBoxes.mock.calls.map(([houseId, q]) => [houseId, q])).toEqual([['H1', undefined]]);
      expect(queryClient.getQueryState(queries.boxSearch('H1', 'U1', 'supplies').queryKey)?.isInvalidated).toBe(true);
    } finally {
      subscription.unsubscribe();
      await live.cleanup();
    }
  });

  test('fetches a fresh snapshot when a box changes during the initial load', async () => {
    const fresh = summary('H1', 1);
    listBoxes.mockImplementationOnce(() => new Promise(() => {})).mockResolvedValueOnce([fresh]);
    const source = db.collection(boxInventory('H1', 'U1'));
    const subscription = source.subscribeChanges(() => {});
    try {
      const initialLoad = source.preload();
      await vi.waitFor(() => expect(listBoxes).toHaveBeenCalledTimes(1));
      const initialSignal = listBoxes.mock.calls[0][2];

      await refreshHouseBoxes(queryClient, 'H1');

      await initialLoad;
      expect(initialSignal?.aborted).toBe(true);
      expect(listBoxes).toHaveBeenCalledTimes(2);
      expect(source.toArray.map((box) => box.id)).toEqual([fresh.id]);
    } finally {
      subscription.unsubscribe();
    }
  });

  test('restarts the live inventory after a failed first request', async () => {
    const failure = new Error('Service temporarily unavailable');
    const box = summary('H1', 1);
    listBoxes.mockRejectedValueOnce(failure).mockResolvedValueOnce([box]);
    const source = db.collection(boxInventory('H1', 'U1'));
    const live = createLiveQueryCollection((q) => q.from({ box: source }).orderBy(({ box }) => box.number, 'desc'));
    const subscription = live.subscribeChanges(() => {});
    try {
      await expect(live.preload()).rejects.toThrow(failure.message);
      expect(live.health.sources[0].error?.cause).toBe(failure);

      await live.reload();

      expect(live.status).toBe('ready');
      expect(live.toArray.map((row) => row.id)).toEqual([box.id]);
    } finally {
      subscription.unsubscribe();
      await live.cleanup();
    }
  });
});
