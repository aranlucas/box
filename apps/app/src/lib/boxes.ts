import { collectionOptions, createLiveQueryCollection, type DbClient } from '@tanstack/db';
import { focusManager, onlineManager, type QueryClient } from '@tanstack/query-core';
import { queryCollectionOptions } from '@tanstack/query-db-collection';

import { api } from './api';
import { houseBoxesKey } from './queries';

export function boxInventory(houseId: string, userId: string) {
  const queryKey = [...houseBoxesKey(houseId), userId, 'inventory'] as const;
  const id = JSON.stringify(queryKey);

  return collectionOptions(id, (client) =>
    queryCollectionOptions({
      id,
      queryKey,
      queryClient: client.requireDependency<QueryClient>('queryClient'),
      queryFn: ({ signal }) => api.listBoxes(houseId, '', signal),
      getKey: (box) => box.id,
    }),
  );
}

function getInventorySource(db: DbClient, houseId: string, userId: string) {
  return db.collection(boxInventory(houseId, userId));
}

type InventorySource = ReturnType<typeof getInventorySource>;
const orderedInventories = new WeakMap<
  InventorySource,
  ReturnType<typeof createOrderedInventory>
>();

export function orderedBoxInventory(db: DbClient, houseId: string, userId: string) {
  const source = getInventorySource(db, houseId, userId);
  let inventory = orderedInventories.get(source);
  if (!inventory) {
    inventory = createOrderedInventory(source);
    orderedInventories.set(source, inventory);
  }
  return inventory;
}

function createOrderedInventory(source: InventorySource) {
  const inventory = createLiveQueryCollection((q) =>
    q.from({ box: source }).orderBy(({ box }) => box.number, 'desc'),
  );
  const retry = (available: boolean) => {
    if (available && onlineManager.isOnline()) {
      void inventory.reload().catch(() => {});
    }
  };

  // A failed first load requires a new DB sync run. Refetch errors recover through Query.
  let unsubscribe: (() => void) | undefined;
  function updateRecovery() {
    if (inventory.status === 'error' && inventory.subscriberCount > 0) {
      if (!unsubscribe) {
        const stopFocus = focusManager.subscribe(retry);
        const stopOnline = onlineManager.subscribe(retry);
        unsubscribe = () => {
          stopFocus();
          stopOnline();
        };
      }
    } else {
      unsubscribe?.();
      unsubscribe = undefined;
    }
  }
  inventory.on('status:change', updateRecovery);
  inventory.on('subscribers:change', updateRecovery);
  return inventory;
}

export async function refreshHouseBoxes(client: QueryClient, houseId: string) {
  const filters = { queryKey: houseBoxesKey(houseId) };
  // A request started before the mutation may still be loading its first snapshot.
  await client.cancelQueries(filters);
  await client.invalidateQueries(filters);
}
