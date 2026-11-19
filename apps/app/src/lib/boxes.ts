import { collectionOptions } from '@tanstack/db';
import type { QueryClient } from '@tanstack/query-core';
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

export async function refreshHouseBoxes(client: QueryClient, houseId: string) {
  const filters = { queryKey: houseBoxesKey(houseId) };
  // A request started before the mutation may still be loading its first snapshot.
  await client.cancelQueries(filters);
  await client.invalidateQueries(filters);
}
