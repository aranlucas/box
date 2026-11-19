import { titleLayout } from '@mj/label';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Image, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { api, boxUrl, photoUrl, type Box, type Item } from '@/lib/api';
import { takeBoxPhoto } from '@/lib/photo';
import { printLabel, usePrinter } from '@/lib/printer';
import { Banner, Button, Card, Field, Screen, styles } from '@/ui/components';
import { LabelPreview } from '@/ui/label-preview';
import { PrinterBar } from '@/ui/printer-bar';
import { colors, radius, space } from '@/ui/theme';

type Draft = { title: string; room: string; notes: string; items: Item[] };
const toDraft = (b: Box): Draft => ({ title: b.title, room: b.room ?? '', notes: b.notes ?? '', items: b.items });

export default function BoxScreen() {
  const { id, fresh } = useLocalSearchParams<{ id: string; fresh?: string }>();
  const boxId = (id ?? '').toUpperCase();
  const [box, setBox] = useState<Box | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [addingPhoto, setAddingPhoto] = useState(false);
  const [newItem, setNewItem] = useState('');
  const printer = usePrinter();

  const load = useCallback(async () => {
    try {
      const b = await api.getBox(boxId);
      setBox(b);
      setDraft(toDraft(b));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [boxId]);

  useEffect(() => {
    load();
  }, [load]);

  const dirty = useMemo(() => {
    if (!box || !draft) return false;
    return (
      draft.title !== box.title ||
      draft.room !== (box.room ?? '') ||
      draft.notes !== (box.notes ?? '') ||
      JSON.stringify(draft.items.map((i) => [i.name, i.quantity])) !== JSON.stringify(box.items.map((i) => [i.name, i.quantity]))
    );
  }, [box, draft]);

  const layout = useMemo(() => titleLayout(draft?.title ?? ''), [draft?.title]);

  async function save(): Promise<Box | null> {
    if (!box || !draft) return null;
    if (!dirty) return box;
    setSaving(true);
    setError(null);
    try {
      let b = box;
      if (draft.title !== box.title || draft.room !== (box.room ?? '') || draft.notes !== (box.notes ?? '')) {
        b = await api.updateBox(box.id, { title: draft.title.trim() || `Box ${box.number}`, room: draft.room, notes: draft.notes });
      }
      if (JSON.stringify(draft.items) !== JSON.stringify(box.items)) b = await api.saveItems(box.id, draft.items);
      setBox(b);
      setDraft(toDraft(b));
      return b;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return null;
    } finally {
      setSaving(false);
    }
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

  async function addPhoto() {
    if (!box) return;
    setError(null);
    try {
      if (dirty) await save();
      const photo = await takeBoxPhoto('camera');
      if (!photo) return;
      setAddingPhoto(true);
      const { box: b, aiFailed } = await api.addPhoto(box.id, photo);
      const added = b.items.length - box.items.length;
      setBox(b);
      setDraft(toDraft(b));
      setNotice(aiFailed ? 'Photo saved, but the AI could not read it.' : `Photo added. ${added} new item${added === 1 ? '' : 's'} found.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setAddingPhoto(false);
    }
  }

  async function toggleStatus() {
    if (!box) return;
    const b = await api.updateBox(box.id, { status: box.status === 'packed' ? 'unpacked' : 'packed' });
    setBox(b);
    setDraft((d) => (d ? { ...d } : d));
  }

  async function remove() {
    if (!box) return;
    const doDelete = async () => {
      await api.deleteBox(box.id);
      router.replace('/');
    };
    const msg = `Delete box #${box.number}? This cannot be undone.`;
    if (Platform.OS === 'web') {
      if (window.confirm(msg)) await doDelete();
      return;
    }
    Alert.alert('Delete box', msg, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: doDelete },
    ]);
  }

  const setItems = (fn: (items: Item[]) => Item[]) => setDraft((d) => (d ? { ...d, items: fn(d.items) } : d));

  function addItem() {
    const name = newItem.trim();
    if (!name) return;
    setItems((items) => [...items, { name, quantity: null, source: 'manual' }]);
    setNewItem('');
  }

  if (error && !box) {
    return (
      <Screen>
        <Banner tone="error">{error === 'Not found' ? 'This box does not exist (or was deleted).' : error}</Banner>
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
          <TextInput
            value={newItem}
            onChangeText={setNewItem}
            onSubmitEditing={addItem}
            placeholder="Add an item…"
            placeholderTextColor={colors.muted}
            returnKeyType="done"
            blurOnSubmit={false}
            style={[s.itemInput, { flex: 1 }]}
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
