import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useForm } from 'react-hook-form';
import { Platform, Share, StyleSheet, Text, View } from 'react-native';

import {
  api,
  displayName,
  type House,
  type Member,
  type PendingInvite,
  type User,
} from '@/lib/api';
import { confirm } from '@/lib/confirm';
import { queries } from '@/lib/queries';
import { useEnterHouse, useSession, useSignOut } from '@/lib/session';
import { count } from '@/lib/util';
import { Banner, Button, Card, LinkButton, LoadingScreen, Screen, styles } from '@/ui/components';
import { FormField } from '@/ui/form-field';
import { PrinterBar } from '@/ui/printer-bar';
import { colors, space } from '@/ui/theme';

const HOUSE_NAME_MAX = 60;
const daysUntil = (time: number) => Math.max(1, Math.round((time - Date.now()) / 86_400_000));

export default function SettingsScreen() {
  const session = useSession();
  if (session.status === 'loading') {
    return <LoadingScreen />;
  }
  if (session.status === 'signed-out') {
    return (
      <Screen>
        <Banner>Sign in first.</Banner>
      </Screen>
    );
  }
  const { user, house } = session;
  return (
    <Screen>
      <Account user={user} />
      {house ? <HouseSettings house={house} user={user} /> : null}
    </Screen>
  );
}

function Account({ user }: { user: User }) {
  const signOut = useSignOut();
  return (
    <Card>
      <Text style={styles.label}>Signed in as</Text>
      <Text style={styles.h2}>{displayName(user) ?? 'Your account'}</Text>
      {user.name && user.email ? <Text style={styles.muted}>{user.email}</Text> : null}
      {signOut.error ? <Banner tone="error">{signOut.error.message}</Banner> : null}
      <Button
        label="Sign out"
        variant="secondary"
        busy={signOut.isPending}
        onPress={() => {
          signOut.mutate(undefined, { onSuccess: () => router.replace('/') });
        }}
      />
    </Card>
  );
}

function HouseSettings({ house, user }: { house: House; user: User }) {
  const people = useQuery(queries.members(house.id));
  const isOwner = house.role === 'owner';
  return (
    <>
      <View style={s.house}>
        <Text style={styles.kicker}>{isOwner ? 'House · you’re the owner' : 'House · member'}</Text>
        <Text style={styles.h2} accessibilityRole="header">
          {house.name}
        </Text>
      </View>
      {people.error ? <Banner tone="error">{people.error.message}</Banner> : null}
      {people.data ? <People house={house} me={user} members={people.data.members} /> : null}
      {isOwner ? <Invites house={house} pending={people.data?.invites ?? []} /> : null}
      <Card>
        <Text style={styles.h2}>Printer</Text>
        <PrinterBar houseId={house.id} showTable />
      </Card>
      {isOwner ? <NewHouse /> : null}
    </>
  );
}

function People({ house, me, members }: { house: House; me: User; members: Member[] }) {
  const qc = useQueryClient();
  const isOwner = house.role === 'owner';
  const owners = members.filter((m) => m.role === 'owner').length;
  const remove = useMutation({
    mutationFn: async (member: Member) => {
      const leaving = member.user_id === me.id;
      const sure = leaving
        ? await confirm(
            'Leave house',
            `Leave “${house.name}”? You’ll need a new invite to come back.`,
            'Leave',
          )
        : await confirm(
            'Remove member',
            `Remove ${displayName(member) ?? 'this member'} from “${house.name}”?`,
            'Remove',
          );
      if (!sure) {
        return;
      }
      await api.removeMember(house.id, member.user_id);
      // Leaving changes which houses this user has; removing someone else only changes this list.
      await qc.invalidateQueries({
        queryKey: leaving ? queries.me().queryKey : queries.members(house.id).queryKey,
      });
      if (leaving) {
        router.replace('/');
      }
    },
  });

  return (
    <Card>
      <Text style={styles.h2}>People</Text>
      {members.map((member) => {
        const isMe = member.user_id === me.id;
        const name = displayName(member);
        // A house needs an owner, so its only owner can't leave (or be removed).
        const canRemove = (isOwner || isMe) && !(member.role === 'owner' && owners === 1);
        return (
          <View key={member.user_id} style={styles.spread}>
            <View style={styles.shrink}>
              <Text style={[styles.body, !name && s.unnamed]}>
                {name ?? 'Name not shared yet'}
                {isMe ? ' (you)' : ''}
              </Text>
              <Text style={styles.muted}>{member.role === 'owner' ? 'Owner' : 'Member'}</Text>
            </View>
            {canRemove ? (
              <LinkButton
                label={isMe ? 'Leave' : 'Remove'}
                tone="danger"
                onPress={() => {
                  remove.mutate(member);
                }}
              />
            ) : null}
          </View>
        );
      })}
      {remove.error ? <Banner tone="error">{remove.error.message}</Banner> : null}
    </Card>
  );
}

/** Hands the invite link to the system share sheet; where there is none, copies it instead. Resolves true if it was copied. */
async function shareInvite(house: House, url: string): Promise<boolean> {
  const message = `Join “${house.name}” on Box: ${url}`;
  if (Platform.OS !== 'web') {
    await Share.share({ message });
    return false;
  }
  const { clipboard } = navigator;
  // Desktop Firefox has no share sheet.
  if ('share' in navigator) {
    // Closing the share sheet rejects; that is not a failure.
    await navigator.share({ title: 'Box invite', text: message, url }).catch(() => {});
    return false;
  }
  await clipboard.writeText(url);
  return true;
}

function Invites({ house, pending }: { house: House; pending: PendingInvite[] }) {
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ queryKey: queries.members(house.id).queryKey });
  const create = useMutation({
    mutationFn: async () => {
      const { url } = await api.createInvite(house.id);
      void refresh();
      return { url, copied: await shareInvite(house, url) };
    },
  });
  const revoke = useMutation({
    mutationFn: (inviteId: string) => api.revokeInvite(house.id, inviteId),
    onSuccess: refresh,
  });

  return (
    <Card>
      <Text style={styles.h2}>Invite someone</Text>
      <Text style={styles.body}>
        Send a link by text or chat. It works once and expires in 7 days. They’ll sign in, then tap
        Join.
      </Text>
      <Button
        label="Create invite link"
        busy={create.isPending}
        onPress={() => {
          create.mutate();
        }}
      />
      {create.data ? (
        <Text selectable style={s.link}>
          {create.data.url}
        </Text>
      ) : null}
      {create.data?.copied ? <Banner tone="success">Invite link copied.</Banner> : null}
      {create.error ? <Banner tone="error">{create.error.message}</Banner> : null}
      {pending.length > 0 ? (
        <View style={s.pending}>
          <Text style={styles.label}>Pending invites</Text>
          {pending.map((invite) => (
            <View key={invite.id} style={styles.spread}>
              <Text style={styles.muted}>
                Expires in {count(daysUntil(invite.expires_at), 'day')}
              </Text>
              <Button
                label="Revoke"
                variant="danger"
                busy={revoke.isPending && revoke.variables === invite.id}
                onPress={() => {
                  revoke.mutate(invite.id);
                }}
              />
            </View>
          ))}
        </View>
      ) : null}
      {revoke.error ? <Banner tone="error">{revoke.error.message}</Banner> : null}
    </Card>
  );
}

function NewHouse() {
  const enterHouse = useEnterHouse();
  const form = useForm({ defaultValues: { name: '' }, mode: 'onChange' });
  const create = useMutation({
    mutationFn: async (name: string) => {
      await enterHouse(await api.createHouse(name));
      router.replace('/');
    },
  });
  const submit = () => {
    void form.handleSubmit(({ name }) => {
      create.mutate(name.trim());
    })();
  };

  return (
    <Card>
      <Text style={styles.h2}>Another house</Text>
      <Text style={styles.muted}>
        For a second home, storage unit or garage. Box numbers start at 1 in each house.
      </Text>
      <FormField
        control={form.control}
        name="name"
        rules={{
          validate: (name) =>
            (name.trim().length > 0 && name.trim().length <= HOUSE_NAME_MAX) ||
            `Name it in 1–${HOUSE_NAME_MAX} characters`,
        }}
        accessibilityLabel="House name"
        placeholder="e.g. Storage unit"
        onSubmitEditing={submit}
      />
      {create.error ? <Banner tone="error">{create.error.message}</Banner> : null}
      <Button
        label="Create house"
        variant="secondary"
        busy={create.isPending}
        disabled={!form.formState.isValid}
        onPress={submit}
      />
    </Card>
  );
}

const s = StyleSheet.create({
  house: { gap: space(1), marginTop: space(2) },
  unnamed: { color: colors.muted },
  link: {
    fontSize: 14,
    color: colors.kraftDark,
    backgroundColor: colors.kraftSoft,
    padding: space(2),
    borderRadius: 8,
  },
  pending: { gap: space(2) },
});
