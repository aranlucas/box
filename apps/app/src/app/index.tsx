import { useMutation, useQuery } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import {
  ActivityIndicator,
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
  type ImageSourcePropType,
} from 'react-native';

import { api, type BoxSummary, type House } from '@/lib/api';
import { remotePrinters, useHousehold } from '@/lib/household';
import { usePrinter } from '@/lib/printer';
import { queries } from '@/lib/queries';
import { useEnterHouse, useSetHouse, useSession, useSignIn, useSignOut } from '@/lib/session';
import { Banner, Button, Card, Field, Screen, styles } from '@/ui/components';
import { FormField } from '@/ui/form-field';
import { PrinterButton, PrinterOptions } from '@/ui/printer-bar';
import { colors, radius, space } from '@/ui/theme';

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

const icon = require('../../assets/images/icon.png') as ImageSourcePropType;

/** App mark beside a page title. */
function Mark({ size = 44 }: { size?: number }) {
  return (
    <Image
      source={icon}
      style={{ width: size, height: size, borderRadius: size * 0.24 }}
      accessibilityIgnoresInvertColors
    />
  );
}

export default function Home() {
  const session = useSession();
  const { auth_error } = useLocalSearchParams<{ auth_error?: string }>();

  if (session.loading && !session.me) {
    return (
      <Screen safeTop>
        <ActivityIndicator color={colors.kraft} style={{ marginTop: space(10) }} />
      </Screen>
    );
  }
  if (!session.me?.user) {
    return <SignedOut error={auth_error ?? session.error} />;
  }
  if (!session.house) {
    return <NoHouse claimable={session.me.legacyHomeClaimable} name={session.me.user.name} />;
  }
  return <Boxes house={session.house} />;
}

function SignedOut({ error }: { error?: string | null }) {
  const signIn = useSignIn();
  const err = signIn.error ? errMsg(signIn.error) : null;
  return (
    <Screen safeTop>
      <View style={[styles.row, { gap: space(3) }]}>
        <Mark />
        <Text style={styles.h1}>Moving boxes</Text>
      </View>
      <Card>
        <Text style={styles.body}>Sign in to pack, print and search your household’s boxes.</Text>
        {error || err ? (
          <Banner tone="error">{err ?? 'Sign-in did not complete. Please try again.'}</Banner>
        ) : null}
        <Button label="Sign in" busy={signIn.isPending} onPress={() => signIn.mutate('/')} />
      </Card>
      <Text style={styles.muted}>
        Just unpacking? Scan the QR code on a box with your phone camera — no sign-in needed.
      </Text>
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
  const claimMut = useMutation({
    mutationFn: (key: string) => api.claimHome(key),
    onSuccess: enterHouse,
  });
  const claim = () => {
    void form.handleSubmit(({ key }) => claimMut.mutate(key.trim()))();
  };
  const err = claimMut.error ? errMsg(claimMut.error) : null;

  return (
    <Screen safeTop>
      <Text style={styles.h1}>Hi{name ? `, ${name.split(' ')[0]}` : ''}</Text>
      {claimable ? (
        <Card>
          <Text style={styles.h2}>Claim your existing boxes</Text>
          <Text style={styles.body}>
            Boxes packed before sign-in live in a house called “Home”. Enter the old household key
            once to become its owner.
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
          <Button
            label="Claim Home"
            busy={claimMut.isPending}
            disabled={!form.formState.isValid}
            onPress={claim}
          />
        </Card>
      ) : null}
      <Card>
        <Text style={styles.h2}>Joining someone’s house?</Text>
        <Text style={styles.body}>
          Ask a household member to send you an invite link, then open it on this device.
        </Text>
      </Card>
      {signOut.error ? <Banner tone="error">{errMsg(signOut.error)}</Banner> : null}
      <Button
        label="Sign out"
        variant="ghost"
        busy={signOut.isPending}
        onPress={() => signOut.mutate()}
      />
    </Screen>
  );
}

function Boxes({ house }: { house: House }) {
  const session = useSession();
  const houses = session.me?.houses ?? [];
  const setHouse = useSetHouse();
  const [q, setQ] = useState('');
  const input = q.trim();
  const [query, setQuery] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => setQuery(input), input ? 450 : 0);
    return () => clearTimeout(timer);
  }, [input]);
  const list = useQuery(queries.boxes(house.id, query));
  const awaitingQuery = query !== input || list.isPlaceholderData;
  const boxes: BoxSummary[] | undefined = awaitingQuery ? undefined : list.data;
  const error = !awaitingQuery && list.error ? errMsg(list.error) : null;
  const [refreshing, setRefreshing] = useState(false);
  async function refresh() {
    setRefreshing(true);
    await list.refetch();
    setRefreshing(false);
  }
  const [printerOptionsOpen, setPrinterOptionsOpen] = useState(false);
  const printer = usePrinter();
  const household = useHousehold();
  const localReady = printer.status === 'connected' || printer.status === 'printing';
  // A printer on another device in this house, when this device has none connected.
  const via =
    localReady || household.houseId !== house.id ? undefined : remotePrinters(household)[0];
  const printerAvailable = localReady || !!via;
  const printingUnavailable = !printerAvailable && printer.status === 'unsupported';

  return (
    <Screen
      safeTop
      onRefresh={() => {
        void refresh();
      }}
      refreshing={refreshing}
    >
      <View style={[styles.row, { justifyContent: 'space-between' }]}>
        <View style={[styles.row, { gap: space(3), flexShrink: 1 }]}>
          <Mark />
          <View style={{ flexShrink: 1 }}>
            <Text style={s.kicker} numberOfLines={1}>
              {house.name}
            </Text>
            <Text style={styles.h1}>Boxes</Text>
          </View>
        </View>
        <View style={[styles.row, { gap: space(1), flexShrink: 0 }]}>
          <PrinterButton
            availability={
              printerAvailable ? 'ready' : printingUnavailable ? 'unavailable' : 'setup'
            }
            onPress={() => setPrinterOptionsOpen(true)}
          />
          <Button label="Settings" variant="secondary" onPress={() => router.push('/settings')} />
        </View>
      </View>
      <PrinterOptions
        visible={printerOptionsOpen}
        houseId={house.id}
        onClose={() => setPrinterOptionsOpen(false)}
      />
      {houses.length > 1 ? (
        <View style={[styles.row, { flexWrap: 'wrap' }]}>
          {houses.map((h) => (
            <Pressable
              key={h.id}
              onPress={() => setHouse.mutate(h.id)}
              style={[s.chip, h.id === house.id && s.chipOn]}
              accessibilityRole="button"
              accessibilityState={{ selected: h.id === house.id }}
            >
              <Text style={[s.chipText, h.id === house.id && { color: '#fff' }]}>{h.name}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
      <Button
        label="＋  New box"
        big
        onPress={() => router.push({ pathname: '/new', params: { house: house.id } })}
      />
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
        <ActivityIndicator
          color={colors.kraft}
          accessibilityLabel={input ? 'Searching boxes' : 'Loading boxes'}
        />
      ) : boxes.length === 0 ? (
        <View style={s.empty}>
          <Mark size={64} />
          <Text style={[styles.h2, { textAlign: 'center' }]}>
            {input ? `Nothing matches “${input}”` : 'No boxes yet'}
          </Text>
          <Text style={[styles.muted, { textAlign: 'center' }]}>
            {input
              ? 'Try an item name, a description like “baking supplies”, or a box number such as #12.'
              : 'Before you close a box, tap “New box” and photograph what’s inside. You’ll get a contents list and a label to print.'}
          </Text>
        </View>
      ) : (
        <View style={{ gap: space(2) }}>
          {boxes.map((b) => (
            <Pressable
              key={b.id}
              accessibilityRole="button"
              accessibilityLabel={`Box ${b.number}, ${b.title}${b.status === 'unpacked' ? ', unpacked' : ''}`}
              onPress={() => router.push(`/b/${b.id}`)}
              style={({ pressed }) => [s.box, pressed && { opacity: 0.85 }]}
            >
              <View
                style={[s.num, b.status === 'unpacked' && { backgroundColor: colors.greenSoft }]}
              >
                <Text style={[s.numText, b.status === 'unpacked' && { color: colors.green }]}>
                  {b.number}
                </Text>
              </View>
              <View style={{ flex: 1, gap: 2 }}>
                <View style={styles.row}>
                  <Text style={s.title} numberOfLines={1}>
                    {b.title}
                  </Text>
                  {b.status === 'unpacked' ? <Text style={s.unpacked}>Unpacked</Text> : null}
                </View>
                {b.room ? (
                  <Text style={s.room} numberOfLines={1}>
                    {b.room}
                  </Text>
                ) : null}
                <Text style={styles.muted} numberOfLines={2}>
                  {b.preview || 'No items listed'}
                  {b.item_count > 6 ? ` +${b.item_count - 6} more` : ''}
                </Text>
              </View>
              <Text style={s.chevron} importantForAccessibility="no">
                ›
              </Text>
            </Pressable>
          ))}
        </View>
      )}
    </Screen>
  );
}

const s = StyleSheet.create({
  kicker: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.kraftDark,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
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
  numText: {
    fontSize: 20,
    fontWeight: '800',
    color: colors.kraftDark,
    fontVariant: ['tabular-nums'],
  },
  room: { fontSize: 13, fontWeight: '600', color: colors.kraftDark },
  chevron: { fontSize: 26, color: colors.line, marginLeft: -space(1) },
  empty: {
    alignItems: 'center',
    gap: space(2),
    paddingVertical: space(10),
    paddingHorizontal: space(4),
  },
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
