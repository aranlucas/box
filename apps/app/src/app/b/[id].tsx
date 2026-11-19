import { titleLayout } from '@mj/label';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { ActivityIndicator, Alert, Image, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { api, ApiError, boxUrl, photoUrl, type Box, type FormDataPhoto, type Item } from '@/lib/api';
import { queries } from '@/lib/queries';
import { takeBoxPhoto } from '@/lib/photo';
import { printLabel, usePrinter } from '@/lib/printer';
import { Banner, Button, Card, Field, Screen, styles } from '@/ui/components';
import { FormField } from '@/ui/form-field';
import { LabelPreview } from '@/ui/label-preview';
import { PrinterBar } from '@/ui/printer-bar';
import { colors, radius, space } from '@/ui/theme';

type Draft = { title: string; room: string; notes: string; items: Item[] };
const toDraft = (b: Box): Draft => ({ title: b.title, room: b.room ?? '', notes: b.notes ?? '', items: b.items });

export default function BoxScreen() {
  const { id, fresh } = useLocalSearchParams<{ id: string; fresh?: string }>();
  const boxId = (id ?? '').toUpperCase();
  const qc = useQueryClient();
  const boxQuery = useQuery(queries.box(boxId));
  const box = boxQuery.data ?? null;
  // Local edits layered on top of the server copy; null = no unsaved changes.
  const [edits, setEdits] = useState<Draft | null>(null);
  const draft = edits ?? (box ? toDraft(box) : null);
  const setDraft = (d: Draft) => setEdits(d);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const itemForm = useForm<{ name: string }>({ defaultValues: { name: '' } });
  const printer = usePrinter();

  /** Server returned a fresh box: update the cache, drop local edits, refresh lists. */
  function accept(b: Box) {
    qc.setQueryData(queries.box(boxId).queryKey, { ...b, can_edit: b.can_edit ?? box?.can_edit });
    setEdits(null);
    qc.invalidateQueries({ queryKey: queries.allBoxes() });
  }

  const dirty = useMemo(() => {
    if (!box || !edits) return false;
    return (
      edits.title !== box.title ||
      edits.room !== (box.room ?? '') ||
      edits.notes !== (box.notes ?? '') ||
      JSON.stringify(edits.items.map((i) => [i.name, i.quantity])) !== JSON.stringify(box.items.map((i) => [i.name, i.quantity]))
    );
  }, [box, edits]);

  const layout = useMemo(() => titleLayout(draft?.title ?? ''), [draft?.title]);

  const saveMut = useMutation({
    mutationFn: async (d: Draft): Promise<Box> => {
      let b = box!;
      if (d.title !== b.title || d.room !== (b.room ?? '') || d.notes !== (b.notes ?? '')) {
        b = await api.updateBox(b.id, { title: d.title.trim() || `Box ${b.number}`, room: d.room, notes: d.notes });
      }
      if (JSON.stringify(d.items) !== JSON.stringify(box!.items)) b = await api.saveItems(b.id, d.items);
      return b;
    },
    onSuccess: accept,
    onError: (e) => setError(e.message),
  });

  async function save(): Promise<Box | null> {
    if (!box || !draft) return null;
    if (!dirty) return box;
    setError(null);
    return saveMut.mutateAsync(draft).catch(() => null);
  }

  async function print() {
    setError(null);
    setNotice(null);
    const b = await save();
    if (!b) return;
    try {
      await printLabel({ number: b.number, title: b.title, url: boxUrl(b.id) });
      setNotice(`Label for box #${b.number} sent to the printer.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  const photoMut = useMutation({
    mutationFn: (photo: FormDataPhoto) => api.addPhoto(boxId, photo),
    onSuccess: ({ box: b, aiFailed }) => {
      const added = b.items.length - (box?.items.length ?? 0);
      accept(b);
      setNotice(aiFailed ? 'Photo saved, but the AI could not read it.' : `Photo added. ${added} new item${added === 1 ? '' : 's'} found.`);
    },
    onError: (e) => setError(e.message),
  });

  async function addPhoto() {
    if (!box) return;
    setError(null);
    try {
      if (dirty && !(await save())) return;
      const photo = await takeBoxPhoto('camera');
      if (photo) photoMut.mutate(photo);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  const statusMut = useMutation({
    mutationFn: (status: Box['status']) => api.updateBox(boxId, { status }),
    onSuccess: (b) => {
      qc.setQueryData(queries.box(boxId).queryKey, { ...b, can_edit: box?.can_edit });
      qc.invalidateQueries({ queryKey: queries.allBoxes() });
    },
    onError: (e) => setError(e.message),
  });
  const toggleStatus = () => box && statusMut.mutate(box.status === 'packed' ? 'unpacked' : 'packed');

  const deleteMut = useMutation({
    mutationFn: () => api.deleteBox(boxId),
    onSuccess: () => {
      qc.removeQueries({ queryKey: queries.box(boxId).queryKey });
      qc.invalidateQueries({ queryKey: queries.allBoxes() });
      router.replace('/');
    },
    onError: (e) => setError(e.message),
  });

  function remove() {
    if (!box) return;
    const msg = `Delete box #${box.number}? This cannot be undone.`;
    if (Platform.OS === 'web') {
      if (window.confirm(msg)) deleteMut.mutate();
      return;
    }
    Alert.alert('Delete box', msg, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => deleteMut.mutate() },
    ]);
  }

  const setItems = (fn: (items: Item[]) => Item[]) => draft && setEdits({ ...draft, items: fn(draft.items) });

  const addItem = () =>
    void itemForm.handleSubmit(({ name }) => {
      const trimmed = name.trim();
      if (!trimmed) return;
      setItems((items) => [...items, { name: trimmed, quantity: null, source: 'manual' }]);
      itemForm.reset();
    })();

  if (boxQuery.error && !box) {
    const notFound = boxQuery.error instanceof ApiError && boxQuery.error.status === 404;
    return (
      <Screen>
        <Banner tone="error">{notFound ? 'This box does not exist (or was deleted).' : boxQuery.error.message}</Banner>
      </Screen>
    );
  }
  if (!box || !draft) {
    return (
      <Screen>
        <ActivityIndicator color={colors.kraft} style={{ marginTop: space(10) }} />
      </Screen>
    );
  }
  const saving = saveMut.isPending;
  const addingPhoto = photoMut.isPending;

  const header = <Stack.Screen options={{ title: `Box #${box.number}` }} />;

  // Read-only view for anyone who scanned the label without the household key.
  // Read-only unless the viewer belongs to this box's house (server decides).
  if (!box.can_edit) {
    return (
      <Screen>
        {header}
        <View style={{ gap: space(1) }}>
          <Text style={s.kicker}>Box #{box.number}{box.room ? ` · ${box.room}` : ''}</Text>
          <Text style={styles.h1}>{box.title}</Text>
        </View>
        {box.status === 'unpacked' ? <Banner tone="success">Marked as unpacked.</Banner> : null}
        <Card>
          {box.items.length === 0 ? (
            <Text style={styles.muted}>No items listed.</Text>
          ) : (
            box.items.map((it, i) => (
              <Text key={i} style={styles.body}>
                • {it.name}
                {it.quantity ? `  ×${it.quantity}` : ''}
              </Text>
            ))
          )}
          {box.notes ? <Text style={[styles.muted, { marginTop: space(2) }]}>{box.notes}</Text> : null}
        </Card>
        <Photos box={box} />
      </Screen>
    );
  }

  return (
    <Screen>
      {header}
      {fresh === 'ai-failed' ? (
        <Banner tone="error">The photo was saved but the AI couldn’t read it. Add items by hand or try another photo.</Banner>
      ) : fresh ? (
        <Banner>Check the title and list, then print the label.</Banner>
      ) : null}

      <View style={{ gap: space(1) }}>
        <Text style={s.kicker}>Box #{box.number}</Text>
        <TextInput
          value={draft.title}
          onChangeText={(title) => setDraft({ ...draft, title })}
          style={s.titleInput}
          placeholder={`Box ${box.number}`}
          placeholderTextColor={colors.muted}
        />
        {!layout.fits ? <Text style={[styles.muted, { color: colors.red }]}>Too long for the label — it will be cut off.</Text> : null}
      </View>

      <Card style={{ alignItems: 'center' }}>
        <LabelPreview input={{ number: box.number, title: draft.title || `Box ${box.number}`, url: boxUrl(box.id) }} />
        <View style={{ alignSelf: 'stretch', gap: space(2) }}>
          <Button
            label={printer.status === 'printing' ? 'Printing…' : dirty ? 'Save & print label' : 'Print label'}
            big
            busy={printer.status === 'printing' || saving}
            disabled={printer.status === 'unsupported'}
            onPress={print}
          />
          <PrinterBar />
        </View>
      </Card>

      {notice ? <Banner tone="success">{notice}</Banner> : null}
      {error ? <Banner tone="error">{error}</Banner> : null}

      <Card>
        <View style={[styles.row, { justifyContent: 'space-between' }]}>
          <Text style={styles.h2}>Contents</Text>
          <Text style={styles.muted}>{draft.items.length} items</Text>
        </View>
        {draft.items.map((it, i) => (
          <View key={i} style={s.itemRow}>
            <TextInput
              value={it.name}
              onChangeText={(name) => setItems((items) => items.map((x, j) => (j === i ? { ...x, name } : x)))}
              style={[s.itemInput, { flex: 1 }]}
            />
            <TextInput
              value={it.quantity ? String(it.quantity) : ''}
              onChangeText={(v) => {
                const n = parseInt(v.replace(/\D/g, ''), 10);
                setItems((items) => items.map((x, j) => (j === i ? { ...x, quantity: Number.isFinite(n) && n > 0 ? n : null } : x)));
              }}
              placeholder="qty"
              placeholderTextColor={colors.muted}
              keyboardType="number-pad"
              style={[s.itemInput, { width: 56, textAlign: 'center' }]}
            />
            <Pressable
              accessibilityLabel={`Remove ${it.name}`}
              onPress={() => setItems((items) => items.filter((_, j) => j !== i))}
              style={s.remove}>
              <Text style={{ fontSize: 20, color: colors.muted }}>×</Text>
            </Pressable>
          </View>
        ))}
        <View style={s.itemRow}>
          <FormField
            control={itemForm.control}
            name="name"
            onSubmitEditing={addItem}
            placeholder="Add an item…"
            returnKeyType="done"
            submitBehavior="submit"
            containerStyle={{ flex: 1 }}
            style={s.itemInput}
          />
          <Button label="Add" variant="secondary" onPress={addItem} />
        </View>
      </Card>

      <Card>
        <Field label="Room" value={draft.room} onChangeText={(room) => setDraft({ ...draft, room })} placeholder="e.g. Kitchen" />
        <Field
          label="Notes"
          value={draft.notes}
          onChangeText={(notes) => setDraft({ ...draft, notes })}
          placeholder="Fragile, open first…"
          multiline
          style={{ minHeight: 72, paddingTop: space(3), textAlignVertical: 'top' }}
        />
      </Card>

      {dirty ? <Button label="Save changes" onPress={save} busy={saving} /> : null}

      <Photos box={box} />
      <Button label="Add another photo" variant="secondary" busy={addingPhoto} onPress={addPhoto} />
      <View style={[styles.row, { justifyContent: 'space-between' }]}>
        <Button
          label={box.status === 'packed' ? 'Mark unpacked' : 'Mark packed'}
          variant="ghost"
          onPress={toggleStatus}
        />
        <Button label="Delete box" variant="danger" onPress={remove} />
      </View>
    </Screen>
  );
}

function Photos({ box }: { box: Box }) {
  if (!box.photos.length) return null;
  return (
    <ScrollView horizontal style={{ flexGrow: 0 }} showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space(2) }}>
      {box.photos.map((p) => (
        <Pressable key={p.id} onPress={() => Platform.OS === 'web' && window.open(photoUrl(p.id), '_blank')}>
          <Image source={{ uri: photoUrl(p.id) }} style={s.photo} accessibilityLabel="Photo of box contents" />
        </Pressable>
      ))}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  kicker: { fontSize: 14, fontWeight: '700', color: colors.kraftDark, textTransform: 'uppercase', letterSpacing: 0.8 },
  titleInput: {
    fontSize: 28,
    fontWeight: '800',
    color: colors.ink,
    paddingVertical: space(1),
    borderBottomWidth: 2,
    borderBottomColor: colors.line,
  },
  itemRow: { flexDirection: 'row', alignItems: 'center', gap: space(2) },
  itemInput: {
    minHeight: 44,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.sm,
    paddingHorizontal: space(3),
    fontSize: 16,
    color: colors.ink,
    backgroundColor: colors.card,
  },
  remove: { width: 40, height: 44, alignItems: 'center', justifyContent: 'center' },
  photo: { width: 220, height: 165, borderRadius: radius.md, backgroundColor: colors.line },
});
