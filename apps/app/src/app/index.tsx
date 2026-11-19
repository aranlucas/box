import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { api, ApiError, getHouseholdKey, type BoxSummary } from '@/lib/api';
import { Banner, Button, Card, Field, Screen, styles } from '@/ui/components';
import { PrinterBar } from '@/ui/printer-bar';
import { colors, radius, space } from '@/ui/theme';

type BoxResults = { query: string; boxes: BoxSummary[] } | { query: string; error: string };

export default function Boxes() {
  const [hasKey, setHasKey] = useState<boolean | null>(null);
  const [q, setQ] = useState('');
  const [result, setResult] = useState<BoxResults | null>(null);
  const query = q.trim();
  const current = result?.query === query ? result : null;
  const boxes = current && 'boxes' in current ? current.boxes : null;
  const error = current && 'error' in current ? current.error : null;

  useFocusEffect(
    useCallback(() => {
      const controller = new AbortController();
      const { signal } = controller;
      const timer = setTimeout(async () => {
        const key = await getHouseholdKey();
        if (signal.aborted) return;
        setHasKey(!!key);
        if (!key) return;

        try {
          const boxes = await api.listBoxes(query, signal);
          if (!signal.aborted) setResult({ query, boxes });
        } catch (e) {
          if (signal.aborted) return;
          if (e instanceof ApiError && e.status === 401) setHasKey(false);
          else setResult({ query, error: e instanceof Error ? e.message : String(e) });
        }
      }, query ? 450 : 0);
      return () => {
        clearTimeout(timer);
        controller.abort();
      };
    }, [query]),
  );

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
        {boxes ? <Text style={styles.muted}>{boxes.length} {query ? 'found' : 'total'}</Text> : null}
      </View>
      <PrinterBar />
      <Button label="＋  New box" big onPress={() => router.push('/new')} />
      <Field
        value={q}
        onChangeText={setQ}
        accessibilityLabel="Search boxes"
        placeholder="Search for cables, baking supplies, #12…"
        autoCapitalize="none"
        autoCorrect={false}
        clearButtonMode="while-editing"
        returnKeyType="search"
      />
      {error ? (
        <Banner tone="error">{error}</Banner>
      ) : !boxes ? (
        <ActivityIndicator color={colors.kraft} accessibilityLabel={query ? 'Searching boxes' : 'Loading boxes'} />
      ) : boxes.length === 0 ? (
        <Text style={[styles.muted, { textAlign: 'center', marginTop: space(6) }]}>
          {query ? 'No boxes match.' : 'No boxes yet. Tap “New box” and photograph what’s inside.'}
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
