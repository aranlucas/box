import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { api, ApiError, getHouseholdKey, type BoxSummary } from '@/lib/api';
import { Banner, Button, Card, Field, Screen, styles } from '@/ui/components';
import { PrinterBar } from '@/ui/printer-bar';
import { colors, radius, space } from '@/ui/theme';

export default function Boxes() {
  const [hasKey, setHasKey] = useState<boolean | null>(null);
  const [q, setQ] = useState('');
  const [boxes, setBoxes] = useState<BoxSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (query: string) => {
    try {
      setError(null);
      setBoxes(await api.listBoxes(query));
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) setHasKey(false);
      else setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      getHouseholdKey().then((k) => {
        setHasKey(!!k);
        if (k) load(q);
      });
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [load]),
  );

  useEffect(() => {
    if (!hasKey) return;
    const t = setTimeout(() => load(q), 250);
    return () => clearTimeout(t);
  }, [q, hasKey, load]);

  if (hasKey === null) return <Screen>{null}</Screen>;

  if (!hasKey) {
    return (
      <Screen>
        <Text style={styles.h1}>Moving boxes</Text>
        <Card>
          <Text style={styles.body}>To add and print boxes on this device, enter your household key.</Text>
          <Button label="Enter household key" onPress={() => router.push('/setup')} />
        </Card>
        <Text style={styles.muted}>Just unpacking? Scan the QR code on a box with your phone camera.</Text>
      </Screen>
    );
  }

  return (
    <Screen>
      <View style={[styles.row, { justifyContent: 'space-between' }]}>
        <Text style={styles.h1}>Boxes</Text>
        {boxes ? <Text style={styles.muted}>{boxes.length} {q ? 'found' : 'total'}</Text> : null}
      </View>
      <PrinterBar showTable />
      <Button label="＋  New box" big onPress={() => router.push('/new')} />
      <Field
        value={q}
        onChangeText={setQ}
        placeholder="Search: blender, towels, #12…"
        autoCapitalize="none"
        autoCorrect={false}
        clearButtonMode="while-editing"
        returnKeyType="search"
      />
      {error ? <Banner tone="error">{error}</Banner> : null}
      {!boxes ? (
        <ActivityIndicator color={colors.kraft} />
      ) : boxes.length === 0 ? (
        <Text style={[styles.muted, { textAlign: 'center', marginTop: space(6) }]}>
          {q ? 'No boxes match.' : 'No boxes yet. Tap “New box” and photograph what’s inside.'}
        </Text>
      ) : (
        <View style={{ gap: space(2) }}>
          {boxes.map((b) => (
            <Pressable key={b.id} onPress={() => router.push(`/b/${b.id}`)} style={({ pressed }) => [s.box, pressed && { opacity: 0.85 }]}>
                <View style={s.num}>
                  <Text style={s.numText}>{b.number}</Text>
                </View>
                <View style={{ flex: 1, gap: 2 }}>
                  <View style={styles.row}>
                    <Text style={s.title} numberOfLines={1}>
                      {b.title}
                    </Text>
                    {b.status === 'unpacked' ? <Text style={s.unpacked}>Unpacked</Text> : null}
                  </View>
                  <Text style={styles.muted} numberOfLines={2}>
                    {[b.room, b.preview].filter(Boolean).join(' · ') || 'No items listed'}
                    {b.item_count > 6 ? ` +${b.item_count - 6} more` : ''}
                  </Text>
                </View>
              </Pressable>
          ))}
        </View>
      )}
    </Screen>
  );
}

const s = StyleSheet.create({
  box: {
    flexDirection: 'row',
    gap: space(3),
    alignItems: 'center',
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.line,
    padding: space(3),
  },
  num: {
    width: 52,
    height: 52,
    borderRadius: radius.md,
    backgroundColor: colors.kraftSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  numText: { fontSize: 20, fontWeight: '800', color: colors.kraftDark },
  title: { fontSize: 17, fontWeight: '700', color: colors.ink, flexShrink: 1 },
  unpacked: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.green,
    backgroundColor: colors.greenSoft,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    overflow: 'hidden',
  },
});
