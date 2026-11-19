import { describe, expect, test } from 'vitest';

import type { Box } from '../src/lib/api';
import { afterPhoto, afterSave, changes, sameHousePlaceholder, toDraft } from '../src/lib/draft';

const box = (over: Partial<Box> = {}): Box => ({
  id: 'B1',
  house_id: 'H1',
  number: 3,
  title: 'Kitchen',
  room: 'Kitchen',
  notes: null,
  status: 'packed',
  created_at: 1,
  updated_at: 100,
  items: [
    { id: 'i1', name: 'pan', quantity: 1, source: 'ai' },
    { id: 'i2', name: 'pot', quantity: null, source: 'ai' },
  ],
  photos: [],
  ...over,
});

describe('changes', () => {
  test('a title-only edit sends only the title, never the item list', () => {
    const base = box();
    const draft = { ...toDraft(base), title: 'Pots & pans' };
    expect(changes(base, draft)).toEqual({ meta: { title: 'Pots & pans' }, items: null });
  });

  test('untouched items stay untouched even if the server copy moved on (diff is vs the base)', () => {
    const base = box();
    const draft = { ...toDraft(base), room: 'Pantry' };
    // someone else added an item on the server; our base is still the old version
    expect(changes(base, draft).items).toBeNull();
  });

  test('editing an item sends the full list', () => {
    const base = box();
    const draft = toDraft(base);
    draft.items = [{ ...draft.items[0], quantity: 2 }, draft.items[1]];
    expect(changes(base, draft).items).toEqual(draft.items);
  });

  test('an emptied title falls back to "Box N"', () => {
    const base = box();
    expect(changes(base, { ...toDraft(base), title: '  ' }).meta).toEqual({ title: 'Box 3' });
  });

  test('no edits → nothing to send', () => {
    const base = box();
    expect(changes(base, toDraft(base))).toEqual({ meta: {}, items: null });
  });
});

describe('afterSave', () => {
  test('clears the edit when nothing was typed during the save', () => {
    const base = box();
    const draft = { ...toDraft(base), title: 'X' };
    expect(afterSave({ base, draft }, draft, box({ title: 'X', updated_at: 200 }))).toBeNull();
  });

  test('keeps edits typed while the save was in flight, rebased on the saved box', () => {
    const base = box();
    const saved = { ...toDraft(base), title: 'X' };
    const typedSince = { ...saved, notes: 'fragile' };
    const next = box({ title: 'X', updated_at: 200 });
    expect(afterSave({ base, draft: typedSince }, saved, next)).toEqual({
      base: next,
      draft: typedSince,
    });
  });
});

describe('afterPhoto', () => {
  test('no local edits → nothing to keep', () => {
    expect(afterPhoto(null, box())).toBeNull();
  });

  test('keeps local edits and appends the items the photo found', () => {
    const base = box();
    const draft = { ...toDraft(base), title: 'Mine' };
    const withNew = box({
      updated_at: 300,
      items: [...base.items, { id: 'i3', name: 'lid', quantity: null, source: 'ai' }],
    });
    const next = afterPhoto({ base, draft }, withNew)!;
    expect(next.base).toBe(withNew);
    expect(next.draft.title).toBe('Mine');
    expect(next.draft.items.map((i) => i.name)).toEqual(['pan', 'pot', 'lid']);
  });
});

describe('sameHousePlaceholder', () => {
  test('keeps previous rows while searching within the same house', () => {
    const rows = [{ id: 'x' }];
    expect(sameHousePlaceholder('H1')(rows, { queryKey: ['boxes', 'H1', 'pa'] })).toBe(rows);
  });
  test('drops previous rows when the house changes', () => {
    expect(
      sameHousePlaceholder('H2')([{ id: 'x' }], { queryKey: ['boxes', 'H1', ''] }),
    ).toBeUndefined();
  });
});
