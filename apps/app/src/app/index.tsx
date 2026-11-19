import { Button as ExpoButton, Host, Picker, Text as ExpoText } from '@expo/ui';
import { useDbClient, useLiveQuery } from '@tanstack/react-db';
import { focusManager, onlineManager, useMutation, useQuery } from '@tanstack/react-query';
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

import { api, type BoxSummary, type House, type User } from '@/lib/api';
import { boxInventory } from '@/lib/boxes';
import { queries } from '@/lib/queries';
import { useEnterHouse, useSession, useSetHouse, useSignIn, useSignOut } from '@/lib/session';
import {
  Banner,
  Button,
  Card,
  Field,
  IconButton,
  ListScreen,
  LoadingScreen,
  Screen,
  styles,
  UnpackedBadge,
} from '@/ui/components';
import { FormField } from '@/ui/form-field';
import { PrinterMenu } from '@/ui/printer-bar';
import { colors, radius, space } from '@/ui/theme';

/** How many item names the server puts in a box's preview line. */
const PREVIEW_ITEMS = 6;
const NEW_BOX_HEIGHT = 64;
/** How long to wait after the last keystroke before searching. */
const SEARCH_DELAY_MS = 450;

// oxlint-disable-next-line typescript/no-unsafe-assignment -- Metro turns an image require() into an asset id
const icon: ImageSourcePropType = require('../../assets/images/icon.png');

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
  // Set by the Worker when sign-in in the browser did not complete (see /auth/callback).
  const { auth_error: authError } = useLocalSearchParams<{ auth_error?: string }>();

  if (session.status === 'loading') {
    return <LoadingScreen safeTop />;
  }
  if (session.status === 'signed-out') {
    return (
      <SignedOut
        error={authError ? 'Sign-in did not complete. Please try again.' : session.error}
      />
    );
  }
  if (!session.house) {
    return <NoHouse user={session.user} claimable={session.legacyHomeClaimable} />;
  }
  return <Boxes userId={session.user.id} house={session.house} houses={session.houses} />;
}

function SignedOut({ error }: { error?: string }) {
  const signIn = useSignIn();
  const problem = signIn.error?.message ?? error;
  return (
    <Screen safeTop>
      <View style={s.brand}>
        <Mark />
        <Text style={styles.h1} accessibilityRole="header">
          Moving boxes
        </Text>
      </View>
      <Card>
        <Text style={styles.body}>Sign in to pack, print and search your household’s boxes.</Text>
        {problem ? <Banner tone="error">{problem}</Banner> : null}
        <Button
          label="Sign in"
          busy={signIn.isPending}
          onPress={() => {
            signIn.mutate('/');
          }}
        />
      </Card>
      <Text style={styles.muted}>
        Just unpacking? Scan the QR code on a box with your phone camera — no sign-in needed.
      </Text>
    </Screen>
  );
}

function NoHouse({ user, claimable }: { user: User; claimable: boolean }) {
  const signOut = useSignOut();
  const [firstName] = user.name?.split(' ') ?? [];
  return (
    <Screen safeTop>
      <Text style={styles.h1} accessibilityRole="header">
        {firstName ? `Hi, ${firstName}` : 'Hi'}
      </Text>
      {claimable ? <ClaimHome /> : null}
      <Card>
        <Text style={styles.h2}>Joining someone’s house?</Text>
        <Text style={styles.body}>
          Ask a household member to send you an invite link, then open it on this device.
        </Text>
      </Card>
      {signOut.error ? <Banner tone="error">{signOut.error.message}</Banner> : null}
      <Button
        label="Sign out"
        variant="ghost"
        busy={signOut.isPending}
        onPress={() => {
          signOut.mutate();
        }}
      />
    </Screen>
  );
}

/** Boxes packed before sign-in existed live in "Home", which the old household key unlocks once. */
function ClaimHome() {
  const enterHouse = useEnterHouse();
  // Browsers set up before sign-in still have the old key saved: pre-fill it.
  const legacyKey = useQuery(queries.legacyKey()).data;
  const form = useForm({
    defaultValues: { key: '' },
    values: legacyKey ? { key: legacyKey } : undefined,
    mode: 'onChange',
  });
  const claim = useMutation({
    mutationFn: (key: string) => api.claimHome(key),
    onSuccess: enterHouse,
  });
  const submit = () => {
    void form.handleSubmit(({ key }) => {
      claim.mutate(key.trim());
    })();
  };

  return (
    <Card>
      <Text style={styles.h2}>Claim your existing boxes</Text>
      <Text style={styles.body}>
        Boxes packed before sign-in live in a house called “Home”. Enter the old household key once
        to become its owner.
      </Text>
      <FormField
        control={form.control}
        name="key"
        rules={{ validate: (key) => key.trim().length > 0 || 'Enter the household key' }}
        label="Household key"
        autoCapitalize="none"
        autoCorrect={false}
        secureTextEntry
        onSubmitEditing={submit}
      />
      {claim.error ? <Banner tone="error">{claim.error.message}</Banner> : null}
      <Button
        label="Claim Home"
        busy={claim.isPending}
        disabled={!form.formState.isValid}
        onPress={submit}
      />
    </Card>
  );
}

/** The text in the search field, and the same text once typing has paused (what is actually searched for). */
function useSearch() {
  const [text, setText] = useState('');
  const input = text.trim();
  const [query, setQuery] = useState('');
  useEffect(() => {
    // Clearing the field shows the full list at once.
    const timer = setTimeout(setQuery, input ? SEARCH_DELAY_MS : 0, input);
    return () => {
      clearTimeout(timer);
    };
  }, [input]);
  return { text, setText, input, query };
}

function Boxes({ userId, house, houses }: { userId: string; house: House; houses: House[] }) {
  const setHouse = useSetHouse();
  const search = useSearch();
  const db = useDbClient();
  const collection = db.collection(boxInventory(house.id, userId));
  const inventory = useLiveQuery({
    query: (q) => q.from({ box: collection }).orderBy(({ box }) => box.number, 'desc'),
  });
  const { collection: liveCollection, isLoadingError } = inventory;
  // A failed first load requires a new DB sync run. Subsequent failures are retried by Query.
  useEffect(() => {
    if (!isLoadingError) {
      return undefined;
    }
    const retry = (available: boolean) => {
      if (available && onlineManager.isOnline()) {
        void liveCollection.reload().catch(() => {});
      }
    };
    const unsubscribeFocus = focusManager.subscribe(retry);
    const unsubscribeOnline = onlineManager.subscribe(retry);
    return () => {
      unsubscribeFocus();
      unsubscribeOnline();
    };
  }, [isLoadingError, liveCollection]);

  const matches = useQuery(queries.boxSearch(house.id, userId, search.query));
  // Rows for an older query are not the answer to what is in the field now.
  const current = search.query === search.input;
  const inventoryRows = inventory.isReady ? inventory.data : undefined;
  const rows = search.input ? matches.data : inventoryRows;
  const boxes = current ? rows : undefined;
  const source = inventory.health?.sources[0];
  const problem = source?.error ?? source?.failureReason ?? inventory.health?.error ?? null;
  const cause = problem?.cause;
  const inventoryError =
    problem && (cause instanceof Error ? cause : new Error('Could not load boxes.'));
  const activeError = search.input ? matches.error : inventoryError;
  const error = current ? activeError : null;
  const refresh = useMutation({
    mutationFn: async () => {
      if (!current || !onlineManager.isOnline()) {
        return;
      }
      if (search.input) {
        await matches.refetch();
      } else if (isLoadingError) {
        await liveCollection.reload();
      } else if (!inventory.isCrashed) {
        await collection.utils.refetch();
      }
    },
  });

  return (
    <ListScreen
      onRefresh={refresh.mutate}
      refreshing={refresh.isPending}
      data={boxes ?? []}
      keyExtractor={(box) => box.id}
      renderItem={({ item }) => <BoxRow box={item} />}
      header={
        <View style={s.header}>
          <View style={styles.spread}>
            <View style={[s.brand, styles.shrink]}>
              <Mark />
              <View style={styles.shrink}>
                <Text style={styles.kicker} numberOfLines={1}>
                  {house.name}
                </Text>
                <Text style={styles.h1} accessibilityRole="header">
                  Boxes
                </Text>
              </View>
            </View>
            <View style={s.actions}>
              <PrinterMenu houseId={house.id} />
              <IconButton
                symbol={{ ios: 'gearshape', android: 'settings', web: 'settings' }}
                label="Settings"
                onPress={() => {
                  router.push('/settings');
                }}
              />
            </View>
          </View>
          {houses.length > 1 ? (
            <Host
              matchContents={{ horizontal: false, vertical: true }}
              style={s.fullWidth}
              colorScheme="light"
              seedColor={colors.kraftDark}
            >
              <Picker
                accessibilityLabel="Switch house"
                selectedValue={house.id}
                enabled={!setHouse.isPending}
                onValueChange={(id) => {
                  if (id !== house.id) {
                    setHouse.mutate(id);
                  }
                }}
              >
                {houses.map((h) => (
                  <Picker.Item key={h.id} label={h.name} value={h.id} />
                ))}
              </Picker>
            </Host>
          ) : null}
          <Host style={s.newBox}>
            <ExpoButton
              variant="text"
              style={{
                width: '100%',
                height: NEW_BOX_HEIGHT,
                borderRadius: radius.lg,
                backgroundColor: colors.ink,
              }}
              onPress={() => {
                router.push({ pathname: '/new', params: { house: house.id } });
              }}
            >
              <ExpoText
                textStyle={{ ...styles.buttonText, ...styles.buttonTextBig, color: '#fff' }}
              >
                ＋ New box
              </ExpoText>
            </ExpoButton>
          </Host>
          <Field
            value={search.text}
            onChangeText={search.setText}
            accessibilityLabel="Search boxes"
            placeholder="Search for cables, baking supplies, #12…"
            autoCapitalize="none"
            autoCorrect={false}
            clearButtonMode="while-editing"
            returnKeyType="search"
          />
          <ListStatus error={error} boxes={boxes} searching={search.input} />
        </View>
      }
    />
  );
}

/** What to show in place of rows: an error, a spinner, or why the list is empty. */
function ListStatus({
  error,
  boxes,
  searching,
}: {
  error: Error | null;
  boxes?: BoxSummary[];
  searching: string;
}) {
  if (error) {
    return <Banner tone="error">{error.message}</Banner>;
  }
  if (!boxes) {
    return (
      <ActivityIndicator
        color={colors.kraft}
        accessibilityLabel={searching ? 'Searching boxes' : 'Loading boxes'}
      />
    );
  }
  if (boxes.length > 0) {
    return null;
  }
  return (
    <View style={s.empty}>
      <Mark size={64} />
      <Text style={[styles.h2, styles.center]}>
        {searching ? `Nothing matches “${searching}”` : 'No boxes yet'}
      </Text>
      <Text style={[styles.muted, styles.center]}>
        {searching
          ? 'Try an item name, a description like “baking supplies”, or a box number such as #12.'
          : 'Before you close a box, tap “New box” and photograph what’s inside. You’ll get a contents list and a label to print.'}
      </Text>
    </View>
  );
}

function BoxRow({ box }: { box: BoxSummary }) {
  const unpacked = box.status === 'unpacked';
  const more = box.item_count - PREVIEW_ITEMS;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Box ${box.number}, ${box.title}${unpacked ? ', unpacked' : ''}`}
      onPress={() => {
        router.push(`/b/${box.id}`);
      }}
      style={({ pressed }) => [s.box, pressed && styles.pressed]}
    >
      <View style={[s.number, unpacked && s.numberUnpacked]}>
        <Text style={[s.numberText, unpacked && s.numberTextUnpacked]}>{box.number}</Text>
      </View>
      <View style={s.summary}>
        <View style={styles.row}>
          <Text style={[s.title, styles.shrink]} numberOfLines={1}>
            {box.title}
          </Text>
          {unpacked ? <UnpackedBadge /> : null}
        </View>
        {box.room ? (
          <Text style={s.room} numberOfLines={1}>
            {box.room}
          </Text>
        ) : null}
        <Text style={styles.muted} numberOfLines={2}>
          {box.preview ?? 'No items listed'}
          {more > 0 ? ` +${more} more` : ''}
        </Text>
      </View>
      <Text style={s.chevron} importantForAccessibility="no">
        ›
      </Text>
    </Pressable>
  );
}

const s = StyleSheet.create({
  header: { gap: space(4) },
  brand: { flexDirection: 'row', alignItems: 'center', gap: space(3) },
  actions: { flexDirection: 'row', alignItems: 'center' },
  fullWidth: { width: '100%' },
  newBox: { width: '100%', height: NEW_BOX_HEIGHT },
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
  number: {
    width: 52,
    height: 52,
    borderRadius: radius.md,
    backgroundColor: colors.kraftSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  numberUnpacked: { backgroundColor: colors.greenSoft },
  numberText: {
    fontSize: 20,
    fontWeight: '800',
    color: colors.kraftDark,
    fontVariant: ['tabular-nums'],
  },
  numberTextUnpacked: { color: colors.green },
  summary: { flex: 1, gap: 2 },
  title: { fontSize: 17, fontWeight: '700', color: colors.ink },
  room: { fontSize: 13, fontWeight: '600', color: colors.kraftDark },
  chevron: { fontSize: 26, color: colors.line, marginLeft: -space(1) },
  empty: {
    alignItems: 'center',
    gap: space(2),
    paddingVertical: space(10),
    paddingHorizontal: space(4),
  },
});
