import { useMutation, useQuery } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useDeferredValue, useState } from 'react';
import { useForm } from 'react-hook-form';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { api, type BoxSummary } from '@/lib/api';
import { queries } from '@/lib/queries';
import { useEnterHouse, useSetHouse, useSession, useSignIn, useSignOut } from '@/lib/session';
import { Banner, Button, Card, Field, Screen, styles } from '@/ui/components';
import { FormField } from '@/ui/form-field';
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
  const signIn = useSignIn();
  const err = signIn.error ? errMsg(signIn.error) : null;
  return (
    <Screen>
      <Text style={styles.h1}>Moving boxes</Text>
      <Card>
        <Text style={styles.body}>Sign in to pack, print and search your household’s boxes.</Text>
        {error || err ? <Banner tone="error">{err ?? 'Sign-in did not complete. Please try again.'}</Banner> : null}
        <Button label="Sign in" busy={signIn.isPending} onPress={() => signIn.mutate('/')} />
      </Card>
      <Text style={styles.muted}>Just unpacking? Scan the QR code on a box with your phone camera — no sign-in needed.</Text>
    </Screen>
  );
}

function NoHouse({ claimable, name }: { claimable: boolean; name: string | null }) {
  const enterHouse = useEnterHouse();
  const signOut = useSignOut();
  // Browsers set up before sign-in still have the old key saved: pre-fill it.
  const legacyKey = useQuery(queries.legacyKey()).data;
  const form = useForm<{ key: string }>({
    defaultValues: { key: '' },
    values: legacyKey ? { key: legacyKey } : undefined,
    mode: 'onChange',
  });
  const claimMut = useMutation({ mutationFn: (key: string) => api.claimHome(key), onSuccess: enterHouse });
  const claim = () => void form.handleSubmit(({ key }) => claimMut.mutate(key.trim()))();
  const err = claimMut.error ? errMsg(claimMut.error) : null;

  return (
    <Screen>
      <Text style={styles.h1}>Hi{name ? `, ${name.split(' ')[0]}` : ''}</Text>
      {claimable ? (
        <Card>
          <Text style={styles.h2}>Claim your existing boxes</Text>
          <Text style={styles.body}>
            Boxes packed before sign-in live in a house called “Home”. Enter the old household key once to become its owner.
          </Text>
          <FormField
            control={form.control}
            name="key"
            rules={{ validate: (v) => v.trim().length > 0 || 'Enter the household key' }}
            label="Household key"
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry
            onSubmitEditing={claim}
          />
          {err ? <Banner tone="error">{err}</Banner> : null}
          <Button label="Claim Home" busy={claimMut.isPending} disabled={!form.formState.isValid} onPress={claim} />
        </Card>
      ) : null}
      <Card>
        <Text style={styles.h2}>Joining someone’s house?</Text>
        <Text style={styles.body}>Ask a household member to send you an invite link, then open it on this device.</Text>
      </Card>
      {signOut.error ? <Banner tone="error">{errMsg(signOut.error)}</Banner> : null}
      <Button label="Sign out" variant="ghost" busy={signOut.isPending} onPress={() => signOut.mutate()} />
    </Screen>
  );
}

function Boxes() {
  const session = useSession();
  const house = session.house!;
  const houses = session.me?.houses ?? [];
  const setHouse = useSetHouse();
  const [q, setQ] = useState('');
  const query = useDeferredValue(q.trim());
  const list = useQuery(queries.boxes(house.id, query));
  const boxes: BoxSummary[] | undefined = list.data;
  const error = list.error ? errMsg(list.error) : null;

  return (
    <Screen>
      <View style={[styles.row, { justifyContent: 'space-between' }]}>
        <View style={{ flexShrink: 1 }}>
          <Text style={s.kicker}>{house.name}</Text>
          <Text style={styles.h1}>Boxes</Text>
        </View>
        <Button label="Settings" variant="secondary" onPress={() => router.push('/settings')} />
      </View>
      {houses.length > 1 ? (
        <View style={[styles.row, { flexWrap: 'wrap' }]}>
          {houses.map((h) => (
            <Pressable
              key={h.id}
              onPress={() => setHouse.mutate(h.id)}
              style={[s.chip, h.id === house.id && s.chipOn]}
              accessibilityRole="button"
              accessibilityState={{ selected: h.id === house.id }}>
              <Text style={[s.chipText, h.id === house.id && { color: '#fff' }]}>{h.name}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
      <PrinterBar />
      <Button label="＋  New box" big onPress={() => router.push({ pathname: '/new', params: { house: house.id } })} />
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
