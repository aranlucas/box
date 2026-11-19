import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Alert, Platform, Pressable, Share, StyleSheet, Text, View } from 'react-native';

import { api, displayName, type Member } from '@/lib/api';
import { queries } from '@/lib/queries';
import { useEnterHouse, useSession, useSignOut } from '@/lib/session';
import { Banner, Button, Card, Screen, styles } from '@/ui/components';
import { FormField } from '@/ui/form-field';
import { PrinterBar } from '@/ui/printer-bar';
import { colors, space } from '@/ui/theme';

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));
const days = (ms: number) => Math.max(1, Math.round((ms - Date.now()) / 86_400_000));

function confirm(title: string, message: string, action: string): Promise<boolean> {
  if (Platform.OS === 'web') {
    return Promise.resolve(window.confirm(`${title}\n\n${message}`));
  }
  return new Promise((resolve) =>
    Alert.alert(title, message, [
      { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
      { text: action, style: 'destructive', onPress: () => resolve(true) },
    ]),
  );
}

export default function SettingsScreen() {
  const session = useSession();
  const house = session.house;
  const me = session.me?.user;
  const qc = useQueryClient();
  const enterHouse = useEnterHouse();
  const signOut = useSignOut();
  const people = useQuery(queries.members(house?.id));
  const members = people.data?.members ?? null;
  const invites = people.data?.invites ?? [];
  const refreshPeople = () =>
    qc.invalidateQueries({ queryKey: queries.members(house?.id).queryKey });
  const [link, setLink] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setError] = useState<string | null>(null);
  const error = actionError ?? (people.error ? errMsg(people.error) : null);
  const houseForm = useForm<{ name: string }>({ defaultValues: { name: '' }, mode: 'onChange' });

  const inviteMut = useMutation({
    mutationFn: () => api.createInvite(house!.id),
    onSuccess: async ({ url }) => {
      setLink(url);
      void refreshPeople();
      const message = `Join “${house!.name}” on Moving Boxes: ${url}`;
      if (Platform.OS === 'web') {
        const nav = navigator as Navigator & { share?: (d: ShareData) => Promise<void> };
        if (nav.share) {
          await nav.share({ title: 'Moving Boxes invite', text: message, url }).catch(() => {});
        } else if (nav.clipboard) {
          await nav.clipboard.writeText(url);
          setNotice('Invite link copied. It works once and expires in 7 days.');
        }
      } else {
        await Share.share({ message });
      }
    },
    onError: (e) => setError(errMsg(e)),
  });
  const revokeMut = useMutation({
    mutationFn: (inviteId: string) => api.revokeInvite(house!.id, inviteId),
    onSuccess: refreshPeople,
    onError: (e) => setError(errMsg(e)),
  });
  const removeMut = useMutation({
    mutationFn: (m: Member) => api.removeMember(house!.id, m.user_id),
    onSuccess: async (_r, m) => {
      if (m.user_id === me?.id) {
        await qc.invalidateQueries({ queryKey: queries.me().queryKey });
        router.replace('/');
      } else {
        void refreshPeople();
      }
    },
    onError: (e) => setError(errMsg(e)),
  });
  const createHouseMut = useMutation({
    mutationFn: (name: string) => api.createHouse(name),
    onSuccess: async (h) => {
      await enterHouse(h);
      router.replace('/');
    },
    onError: (e) => setError(errMsg(e)),
  });

  const account = me ? (
    <Card>
      <Text style={styles.label}>Signed in as</Text>
      <Text style={styles.h2}>{displayName(me) ?? 'Your account'}</Text>
      {me.name && me.email ? <Text style={styles.muted}>{me.email}</Text> : null}
      {signOut.error ? <Banner tone="error">{errMsg(signOut.error)}</Banner> : null}
      <Button
        label="Sign out"
        variant="secondary"
        busy={signOut.isPending}
        onPress={() => signOut.mutate(undefined, { onSuccess: () => router.replace('/') })}
      />
    </Card>
  ) : null;

  if (!house || !me) {
    return <Screen>{account ?? <Banner>Sign in first.</Banner>}</Screen>;
  }
  const isOwner = house.role === 'owner';

  function invite() {
    setError(null);
    setNotice(null);
    inviteMut.mutate();
  }

  async function remove(m: Member) {
    const self = m.user_id === me!.id;
    const ok = await confirm(
      self ? 'Leave house' : 'Remove member',
      self
        ? `Leave “${house!.name}”? You’ll need a new invite to come back.`
        : `Remove ${displayName(m) ?? 'this member'} from “${house!.name}”?`,
      self ? 'Leave' : 'Remove',
    );
    if (ok) {
      removeMut.mutate(m);
    }
  }

  const createHouse = () => {
    void houseForm.handleSubmit(({ name }) => createHouseMut.mutate(name.trim()))();
  };

  return (
    <Screen>
      {account}

      <View style={{ gap: space(1), marginTop: space(2) }}>
        <Text style={s.kicker}>{isOwner ? 'House · you’re the owner' : 'House · member'}</Text>
        <Text style={styles.h2}>{house.name}</Text>
      </View>

      {error ? <Banner tone="error">{error}</Banner> : null}
      {notice ? <Banner tone="success">{notice}</Banner> : null}

      <Card>
        <Text style={styles.h2}>People</Text>
        {!members
          ? null
          : members.map((m) => (
              <View key={m.user_id} style={[styles.row, { justifyContent: 'space-between' }]}>
                <View style={{ flexShrink: 1 }}>
                  <Text style={[styles.body, !displayName(m) && { color: colors.muted }]}>
                    {displayName(m) ?? 'Name not shared yet'}
                    {m.user_id === me.id ? ' (you)' : ''}
                  </Text>
                  <Text style={styles.muted}>{m.role === 'owner' ? 'Owner' : 'Member'}</Text>
                </View>
                {isOwner || m.user_id === me.id ? (
                  <Pressable
                    onPress={() => {
                      void remove(m);
                    }}
                    accessibilityRole="button"
                  >
                    <Text style={{ color: colors.red, fontWeight: '600' }}>
                      {m.user_id === me.id ? 'Leave' : 'Remove'}
                    </Text>
                  </Pressable>
                ) : null}
              </View>
            ))}
      </Card>

      {isOwner ? (
        <Card>
          <Text style={styles.h2}>Invite someone</Text>
          <Text style={styles.body}>
            Send a link by text or chat. It works once and expires in 7 days. They’ll sign in, then
            tap Join.
          </Text>
          <Button label="Create invite link" busy={inviteMut.isPending} onPress={invite} />
          {link ? (
            <Text selectable style={s.link}>
              {link}
            </Text>
          ) : null}
          {invites.length ? (
            <View style={{ gap: space(2) }}>
              <Text style={styles.label}>Pending invites</Text>
              {invites.map((i) => (
                <View key={i.id} style={[styles.row, { justifyContent: 'space-between' }]}>
                  <Text style={styles.muted}>Expires in {days(i.expires_at)} days</Text>
                  <Button
                    label="Revoke"
                    variant="danger"
                    busy={revokeMut.isPending && revokeMut.variables === i.id}
                    onPress={() => revokeMut.mutate(i.id)}
                  />
                </View>
              ))}
            </View>
          ) : null}
        </Card>
      ) : null}

      <Card>
        <Text style={styles.h2}>Printer</Text>
        <PrinterBar showTable />
      </Card>

      {isOwner ? (
        <Card>
          <Text style={styles.h2}>Another house</Text>
          <Text style={styles.muted}>
            For a second home, storage unit or garage. Box numbers start at 1 in each house.
          </Text>
          <FormField
            control={houseForm.control}
            name="name"
            rules={{
              validate: (v) =>
                (v.trim().length > 0 && v.trim().length <= 60) || 'Name it in 1–60 characters',
            }}
            placeholder="e.g. Storage unit"
            onSubmitEditing={createHouse}
          />
          <Button
            label="Create house"
            variant="secondary"
            busy={createHouseMut.isPending}
            disabled={!houseForm.formState.isValid}
            onPress={createHouse}
          />
        </Card>
      ) : null}
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
  link: {
    fontSize: 14,
    color: colors.kraftDark,
    backgroundColor: colors.kraftSoft,
    padding: space(2),
    borderRadius: 8,
  },
});
