import type { Box, Item } from './api';

/** Pure editing logic for the box screen (unit-tested in test/draft.test.ts). */

export type Draft = { title: string; room: string; notes: string; items: Item[] };
/** Local edits plus the server version they started from. */
export type Edit = { base: Box; draft: Draft };
export type Changes = { meta: Partial<Pick<Box, 'title' | 'room' | 'notes'>>; items: Item[] | null };

export const toDraft = (b: Box): Draft => ({ title: b.title, room: b.room ?? '', notes: b.notes ?? '', items: b.items });

const itemsKey = (items: Item[]) => JSON.stringify(items.map((i) => [i.name, i.quantity]));

/**
 * What the user actually changed, compared with the version they started editing — not the latest
 * server copy — so a background refetch can't make untouched fields look edited.
 */
export function changes(base: Box, draft: Draft): Changes {
  const start = toDraft(base);
  const meta: Changes['meta'] = {};
  if (draft.title !== start.title) meta.title = draft.title.trim() || `Box ${base.number}`;
  if (draft.room !== start.room) meta.room = draft.room;
  if (draft.notes !== start.notes) meta.notes = draft.notes;
  const items = itemsKey(draft.items) !== itemsKey(start.items) ? draft.items : null;
  return { meta, items };
}

export const hasChanges = (c: Changes) => Object.keys(c.meta).length > 0 || c.items !== null;

/** After a save: drop the edit, unless the user kept typing while it was in flight. */
export function afterSave(current: Edit | null, saved: Draft, next: Box): Edit | null {
  if (!current || current.draft === saved) return null;
  return { base: next, draft: current.draft };
}

/** After a photo adds items server-side: keep local edits and append the newly found items. */
export function afterPhoto(current: Edit | null, next: Box): Edit | null {
  if (!current) return null;
  const known = new Set(current.base.items.map((i) => i.id));
  const found = next.items.filter((i) => !known.has(i.id));
  return { base: next, draft: { ...current.draft, items: [...current.draft.items, ...found] } };
}

/** placeholderData for box lists: keep old rows while typing a search, never across houses. */
export const sameHousePlaceholder =
  (houseId: string) =>
  <T>(prev: T | undefined, prevQuery: { queryKey: readonly unknown[] } | undefined): T | undefined =>
    prevQuery?.queryKey[1] === houseId ? prev : undefined;
