import type { Box, BoxPatch, Item } from './api';

/** Pure editing logic for the box screen (unit-tested in test/draft.test.ts). */

export type Draft = { title: string; room: string; notes: string; items: Item[] };
/** Local edits plus the server version they started from. */
export type Edit = { base: Box; draft: Draft };
/** What to send to the server; `items` is absent when the list was not touched. */
export type Changes = { meta: BoxPatch; items?: Item[] };

export const toDraft = (b: Box): Draft => ({
  title: b.title,
  room: b.room ?? '',
  notes: b.notes ?? '',
  items: b.items,
});

let added = 0;
/** A row the user typed in. Its id only has to be unique on this screen; the server assigns the real one on save. */
export const newItem = (name: string): Item => ({
  id: `new-${++added}`,
  name,
  quantity: null,
  source: 'manual',
});

const itemsKey = (items: Item[]) => JSON.stringify(items.map((i) => [i.name, i.quantity]));

/**
 * What the user actually changed, compared with the version they started editing — not the latest
 * server copy — so a background refetch can't make untouched fields look edited.
 */
export function changes({ base, draft }: Edit): Changes {
  const start = toDraft(base);
  const meta: BoxPatch = {};
  if (draft.title !== start.title) {
    meta.title = draft.title.trim() || `Box ${base.number}`;
  }
  if (draft.room !== start.room) {
    meta.room = draft.room;
  }
  if (draft.notes !== start.notes) {
    meta.notes = draft.notes;
  }
  return itemsKey(draft.items) === itemsKey(start.items) ? { meta } : { meta, items: draft.items };
}

export const hasChanges = (c: Changes) => Object.keys(c.meta).length > 0 || c.items !== undefined;

/** After a save: drop the edit, unless the user kept typing while it was in flight. */
export function afterSave(current: Edit | undefined, saved: Draft, next: Box): Edit | undefined {
  if (!current || current.draft === saved) {
    return undefined;
  }
  return { base: next, draft: current.draft };
}

/** After a photo adds items server-side: keep local edits and append the newly found items. */
export function afterPhoto(current: Edit | undefined, next: Box): Edit | undefined {
  if (!current) {
    return undefined;
  }
  const known = new Set(current.base.items.map((i) => i.id));
  const found = next.items.filter((i) => !known.has(i.id));
  return { base: next, draft: { ...current.draft, items: [...current.draft.items, ...found] } };
}
