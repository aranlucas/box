import { titleLayout } from '@mj/label';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router, Stack } from 'expo-router';
import { useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { api, boxUrl, isApiError, type Box, type Item } from '@/lib/api';
import { confirm } from '@/lib/confirm';
import {
  afterPhoto,
  afterSave,
  changes,
  hasChanges,
  newItem,
  toDraft,
  type Draft,
  type Edit,
} from '@/lib/draft';
import { printAnywhere } from '@/lib/household';
import { takeBoxPhoto } from '@/lib/photo';
import { queries } from '@/lib/queries';
import { count } from '@/lib/util';

import { Banner, BoxKicker, Button, Card, Field, Screen, styles } from './components';
import { LabelPreview } from './label-preview';
import { Photos } from './photos';
import { PrinterButton, PrinterSheet, usePrinting } from './printer-bar';
import { colors, radius, space, TAP } from './theme';

// Android scrolls an overflowing single-line TextInput to its end, so long names show up
// clipped at the start ("ellow instant noodle bowl"). Let them wrap instead; Enter still
// just blurs, and pasted newlines are flattened by oneLine().
const wrapOnAndroid =
  Platform.OS === 'android'
    ? ({
        multiline: true,
        scrollEnabled: false,
        submitBehavior: 'blurAndSubmit',
        textAlignVertical: 'center',
      } as const)
    : {};
const oneLine = (text: string) => text.replaceAll(/[\r\n]+/g, ' ');
/** "12" → 12; anything that is not a positive whole number clears the quantity. */
const toQuantity = (text: string) => Number(text.replaceAll(/\D/g, '')) || null;

const FRESH_HINT = {
  '1': <Banner>Check the title and list, then print the label.</Banner>,
  'ai-failed': (
    <Banner tone="error">
      The photo was saved but the AI couldn’t read it. Add items by hand or try another photo.
    </Banner>
  ),
};
export type Fresh = keyof typeof FRESH_HINT;

/** The box as its house's members see it: everything is editable, and it can be printed. */
export function BoxEditor({ box, fresh }: { box: Box; fresh?: Fresh }) {
  const qc = useQueryClient();
  // Local edits plus the server version they started from; none = no unsaved changes.
  const [edit, setEdit] = useState<Edit>();
  const draft = edit?.draft ?? toDraft(box);
  const change = (fields: Partial<Draft>) => {
    setEdit((current) => ({ base: current?.base ?? box, draft: { ...draft, ...fields } }));
  };
  /** The edit to save, once it differs from what the server has. */
  const unsaved = edit && hasChanges(changes(edit)) ? edit : undefined;
  const [newName, setNewName] = useState('');
  const [printerOpen, setPrinterOpen] = useState(false);

  const { printer, via, availability } = usePrinting(box.house_id);
  useQuery(queries.printerReconnect());

  /** The server returned a newer version of the box: show it, and refresh the lists it appears in. */
  function cache(next: Box) {
    qc.setQueryData(queries.box(box.id).queryKey, next);
    void qc.invalidateQueries({ queryKey: queries.allBoxes() });
  }

  // Sends only what changed since editing started; the item list carries the version it was based on,
  // so it can't silently overwrite someone else's additions (server answers 409).
  const save = useMutation({
    mutationFn: async ({ base, draft: saved }: Edit) => {
      const { items, meta } = changes({ base, draft: saved });
      const withItems = items ? await api.saveItems(base.id, items, base.updated_at) : base;
      return Object.keys(meta).length > 0 ? api.updateBox(base.id, meta) : withItems;
    },
    onSuccess: (next, saved) => {
      cache(next);
      setEdit((current) => afterSave(current, saved.draft, next));
    },
    onError: (error) =>
      isApiError(error, 409)
        ? qc.invalidateQueries({ queryKey: queries.box(box.id).queryKey })
        : undefined,
  });
  const conflict = isApiError(save.error, 409);
  /** The box with any pending edits saved first. */
  const saved = () => (unsaved ? save.mutateAsync(unsaved) : box);

  /** After a 409: throw away local edits and show the latest version. */
  function discard() {
    setEdit(undefined);
    save.reset();
  }

  const print = useMutation({
    mutationFn: async () => {
      const { id, number, title, house_id } = await saved();
      const printedBy = await printAnywhere({ number, title, url: boxUrl(id) }, house_id);
      return printedBy
        ? `Label for box #${number} printed via ${printedBy}.`
        : `Label for box #${number} sent to the printer.`;
    },
  });

  const addPhoto = useMutation({
    mutationFn: async () => {
      const current = await saved();
      const photo = await takeBoxPhoto('camera');
      // Closed the camera without taking one
      if (!photo) {
        return undefined;
      }
      const { box: next, aiFailed } = await api.addPhoto(current.id, photo);
      cache(next);
      setEdit((latest) => afterPhoto(latest, next));
      return aiFailed
        ? 'Photo saved, but the AI could not read it.'
        : `Photo added. ${count(next.items.length - current.items.length, 'new item')} found.`;
    },
  });

  const setStatus = useMutation({
    mutationFn: () =>
      api.updateBox(box.id, { status: box.status === 'packed' ? 'unpacked' : 'packed' }),
    onSuccess: (next) => {
      cache(next);
      // keep any unsaved edits, rebased on the new version
      setEdit((current) => current && { base: next, draft: current.draft });
    },
  });

  const remove = useMutation({
    mutationFn: async () => {
      if (
        !(await confirm(
          'Delete box',
          `Delete box #${box.number}? This cannot be undone.`,
          'Delete',
        ))
      ) {
        return false;
      }
      await api.deleteBox(box.id);
      return true;
    },
    onSuccess: (deleted) => {
      if (!deleted) {
        return;
      }
      qc.removeQueries({ queryKey: queries.box(box.id).queryKey });
      void qc.invalidateQueries({ queryKey: queries.allBoxes() });
      router.replace('/');
    },
  });

  const setItem = (id: string, fields: Partial<Item>) => {
    change({ items: draft.items.map((item) => (item.id === id ? { ...item, ...fields } : item)) });
  };
  function addItem() {
    const name = newName.trim();
    if (!name) {
      return;
    }
    change({ items: [...draft.items, newItem(name)] });
    setNewName('');
  }

  // A failed save shows in the save bar; don't repeat it under the button that triggered the save.
  const ownError = (error: Error | null) =>
    error && error !== save.error ? <Banner tone="error">{error.message}</Banner> : null;

  return (
    <Screen
      footer={
        unsaved ? (
          <>
            {save.error ? <Banner tone="error">{save.error.message}</Banner> : null}
            {conflict ? (
              <Button label="Discard my edits and reload" variant="secondary" onPress={discard} />
            ) : (
              <Button
                label="Save changes"
                busy={save.isPending}
                onPress={() => {
                  save.mutate(unsaved);
                }}
              />
            )}
          </>
        ) : undefined
      }
    >
      {/* The sheet lives in the screen, not in the native header that holds its button. */}
      <Stack.Screen
        options={{
          headerRight: () => (
            <PrinterButton
              houseId={box.house_id}
              onPress={() => {
                setPrinterOpen(true);
              }}
            />
          ),
        }}
      />
      <PrinterSheet
        houseId={box.house_id}
        visible={printerOpen}
        onClose={() => {
          setPrinterOpen(false);
        }}
      />
      {fresh ? FRESH_HINT[fresh] : null}

      <View style={styles.heading}>
        <BoxKicker box={box} />
        <TextInput
          value={draft.title}
          onChangeText={(title) => {
            change({ title: oneLine(title) });
          }}
          {...wrapOnAndroid}
          style={s.titleInput}
          accessibilityLabel="Box title"
          placeholder={`Box ${box.number}`}
          placeholderTextColor={colors.muted}
        />
        {titleLayout(draft.title).fits ? null : (
          <Text style={styles.error}>Too long for the label — it will be cut off.</Text>
        )}
      </View>

      <Card style={s.labelCard}>
        <LabelPreview
          number={box.number}
          title={draft.title || `Box ${box.number}`}
          url={boxUrl(box.id)}
        />
        <View style={s.printing}>
          <Button
            label={`${unsaved ? 'Save & print label' : 'Print label'}${via ? ` via ${via.device_name}` : ''}`}
            big
            busy={print.isPending || printer.status === 'printing'}
            disabled={availability === 'unavailable'}
            onPress={() => {
              print.mutate();
            }}
          />
          {print.isSuccess ? <Banner tone="success">{print.data}</Banner> : ownError(print.error)}
        </View>
      </Card>

      <Card>
        <View style={styles.spread}>
          <Text style={styles.h2} accessibilityRole="header">
            Contents
          </Text>
          <Text style={styles.muted}>{count(draft.items.length, 'item')}</Text>
        </View>
        {draft.items.map((item) => (
          <View key={item.id} style={s.itemRow}>
            <TextInput
              value={item.name}
              onChangeText={(name) => {
                setItem(item.id, { name: oneLine(name) });
              }}
              {...wrapOnAndroid}
              accessibilityLabel="Item"
              style={[s.itemInput, s.itemName]}
            />
            <TextInput
              value={item.quantity ? String(item.quantity) : ''}
              onChangeText={(quantity) => {
                setItem(item.id, { quantity: toQuantity(quantity) });
              }}
              accessibilityLabel={`How many ${item.name}`}
              placeholder="qty"
              placeholderTextColor={colors.muted}
              keyboardType="number-pad"
              style={[s.itemInput, s.itemQuantity]}
            />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Remove ${item.name}`}
              hitSlop={4}
              onPress={() => {
                change({ items: draft.items.filter((other) => other.id !== item.id) });
              }}
              style={({ pressed }) => [s.remove, pressed && styles.pressed]}
            >
              <Text style={s.removeIcon}>×</Text>
            </Pressable>
          </View>
        ))}
        <View style={s.itemRow}>
          <TextInput
            value={newName}
            onChangeText={setNewName}
            onSubmitEditing={addItem}
            accessibilityLabel="New item"
            placeholder="Add an item…"
            placeholderTextColor={colors.muted}
            returnKeyType="done"
            submitBehavior="submit"
            style={[s.itemInput, s.itemName]}
          />
          <Button label="Add" variant="secondary" disabled={!newName.trim()} onPress={addItem} />
        </View>
      </Card>

      <Card>
        <Field
          label="Room"
          value={draft.room}
          onChangeText={(room) => {
            change({ room });
          }}
          placeholder="e.g. Kitchen"
        />
        <Field
          label="Notes"
          value={draft.notes}
          onChangeText={(notes) => {
            change({ notes });
          }}
          placeholder="Fragile, open first…"
          multiline
          style={s.notes}
        />
      </Card>

      <Photos photos={box.photos} />
      <Button
        label="Add another photo"
        variant="secondary"
        busy={addPhoto.isPending}
        onPress={() => {
          addPhoto.mutate();
        }}
      />
      {addPhoto.data ? <Banner tone="success">{addPhoto.data}</Banner> : ownError(addPhoto.error)}

      <View style={styles.spread}>
        <Button
          label={box.status === 'packed' ? 'Mark unpacked' : 'Mark packed'}
          variant="ghost"
          busy={setStatus.isPending}
          onPress={() => {
            setStatus.mutate();
          }}
        />
        <Button
          label="Delete box"
          variant="danger"
          busy={remove.isPending}
          onPress={() => {
            remove.mutate();
          }}
        />
      </View>
      {ownError(setStatus.error ?? remove.error)}
    </Screen>
  );
}

const s = StyleSheet.create({
  titleInput: {
    fontSize: 28,
    fontWeight: '800',
    color: colors.ink,
    paddingVertical: space(1),
    borderBottomWidth: 2,
    borderBottomColor: colors.line,
  },
  labelCard: { alignItems: 'center' },
  printing: { alignSelf: 'stretch', gap: space(2) },
  itemRow: { flexDirection: 'row', alignItems: 'center', gap: space(2) },
  itemInput: {
    minHeight: TAP,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.sm,
    paddingHorizontal: space(3),
    paddingVertical: space(2),
    fontSize: 16,
    color: colors.ink,
    backgroundColor: colors.card,
  },
  // minWidth lets the field shrink on narrow web screens instead of pushing the row's buttons out of the card.
  itemName: { flex: 1, minWidth: 0 },
  itemQuantity: { width: 56, textAlign: 'center' },
  remove: { width: TAP, height: TAP, alignItems: 'center', justifyContent: 'center' },
  removeIcon: { fontSize: 22, color: colors.muted },
  notes: { minHeight: 72, paddingTop: space(3), textAlignVertical: 'top' },
});
