import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { api, type BoxSummary } from '@/lib/api';
import { refreshSession, setHouse, signIn, signOut, useSession } from '@/lib/session-store';
import { Banner, Button, Card, Field, Screen, styles } from '@/ui/components';
import { PrinterBar } from '@/ui/printer-bar';
import { colors, radius, space } from '@/ui/theme';

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

export default function Home() {
  const session = useSession();
  const { auth_error } = useLocalSearchParams<{ auth_error?: string }>();

  if (session.loading && !session.me) {
    return (
      <Screen>
        <ActivityIndicator color={colors.kraft} style={{ marginTop: space(10) }} />
      </Screen>
    );
  }
  if (!session.me?.user) return <SignedOut error={auth_error ?? session.error} />;
  if (!session.house) return <NoHouse claimable={session.me.legacyHomeClaimable} name={session.me.user.name} />;
  return <Boxes />;
}

function SignedOut({ error }: { error?: string | null }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  return (
    <Screen>
      <Text style={styles.h1}>Moving boxes</Text>
      <Card>
        <Text style={styles.body}>Sign in to pack, print and search your household’s boxes.</Text>
        {error || err ? <Banner tone="error">{err ?? 'Sign-in did not complete. Please try again.'}</Banner> : null}
        <Button
          label="Sign in"
          busy={busy}
          onPress={async () => {
            setBusy(true);
            setErr(null);
            try {
              await signIn('/');
            } catch (e) {
              setErr(errMsg(e));
            } finally {
              setBusy(false);
            }
          }}
        />
      </Card>
      <Text style={styles.muted}>Just unpacking? Scan the QR code on a box with your phone camera — no sign-in needed.</Text>
    </Screen>
  );
}

function NoHouse({ claimable, name }: { claimable: boolean; name: string | null }) {
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function claim() {
    setBusy(true);
    setErr(null);
    try {
      await api.claimHome(key.trim());
      await refreshSession();
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <Text style={styles.h1}>Hi{name ? `, ${name.split(' ')[0]}` : ''}</Text>
      {claimable ? (
        <Card>
          <Text style={styles.h2}>Claim your existing boxes</Text>
          <Text style={styles.body}>
            Boxes packed before sign-in live in a house called “Home”. Enter the old household key once to become its owner.
          </Text>
          <Field
            label="Household key"
            value={key}
            onChangeText={setKey}
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry
            onSubmitEditing={claim}
          />
          {err ? <Banner tone="error">{err}</Banner> : null}
          <Button label="Claim Home" busy={busy} disabled={!key.trim()} onPress={claim} />
        </Card>
      ) : null}
      <Card>
        <Text style={styles.h2}>Joining someone’s house?</Text>
        <Text style={styles.body}>Ask a household member to send you an invite link, then open it on this device.</Text>
      </Card>
      <Button label="Sign out" variant="ghost" onPress={signOut} />
    </Screen>
  );
}

function Boxes() {
  const session = useSession();
  const house = session.house!;
  const houses = session.me?.houses ?? [];
  const [q, setQ] = useState('');
  const [boxes, setBoxes] = useState<BoxSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (query: string) => {
    try {
      setError(null);
      setBoxes(await api.listBoxes(query));
    } catch (e) {
      setError(errMsg(e));
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load(q);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [load, house.id]),
  );

  useEffect(() => {
    setBoxes(null);
    const t = setTimeout(() => load(q), 250);
    return () => clearTimeout(t);
  }, [q, house.id, load]);

  return (
    <Screen>
      <View style={[styles.row, { justifyContent: 'space-between' }]}>
        <View style={{ flexShrink: 1 }}>
          <Text style={s.kicker}>{house.name}</Text>
          <Text style={styles.h1}>Boxes</Text>
        </View>
        <Button label="People" variant="secondary" onPress={() => router.push('/house')} />
      </View>
      {houses.length > 1 ? (
        <View style={[styles.row, { flexWrap: 'wrap' }]}>
          {houses.map((h) => (
            <Pressable
              key={h.id}
              onPress={() => setHouse(h.id)}
              style={[s.chip, h.id === house.id && s.chipOn]}
              accessibilityRole="button"
              accessibilityState={{ selected: h.id === house.id }}>
              <Text style={[s.chipText, h.id === house.id && { color: '#fff' }]}>{h.name}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
      <PrinterBar />
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
            <Pressable
              key={b.id}
              onPress={() => router.push(`/b/${b.id}`)}
              style={({ pressed }) => [s.box, pressed && { opacity: 0.85 }]}>
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
      <Text style={[styles.muted, { textAlign: 'center' }]}>
        Signed in as {session.me?.user?.name ?? session.me?.user?.email}
      </Text>
      <Button label="Sign out" variant="ghost" onPress={signOut} />
    </Screen>
  );
}

const s = StyleSheet.create({
  kicker: { fontSize: 14, fontWeight: '700', color: colors.kraftDark, textTransform: 'uppercase', letterSpacing: 0.8 },
  chip: {
    paddingHorizontal: space(3),
    minHeight: 36,
    justifyContent: 'center',
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.card,
  },
  chipOn: { backgroundColor: colors.ink, borderColor: colors.ink },
  chipText: { fontSize: 14, fontWeight: '600', color: colors.ink },
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
