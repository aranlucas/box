import { useMutation, useQuery } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { ActivityIndicator, Text } from 'react-native';

import { api, ApiError, type InviteInfo } from '@/lib/api';
import { keys } from '@/lib/query';
import { useEnterHouse, useSession, useSignIn } from '@/lib/session';
import { Banner, Button, Card, Screen, styles } from '@/ui/components';
import { colors, space } from '@/ui/theme';

const STATUS_COPY: Record<Exclude<InviteInfo['status'], 'valid'>, string> = {
  used: 'This invite link has already been used. Ask for a new one.',
  expired: 'This invite link has expired. Ask for a new one.',
  revoked: 'This invite link was cancelled. Ask for a new one.',
};

export default function Invite() {
  const { token } = useLocalSearchParams<{ token: string }>();
  const session = useSession();
  const signIn = useSignIn();
  const enterHouse = useEnterHouse();
  const inviteQuery = useQuery({ queryKey: keys.invite(token), queryFn: () => api.inviteInfo(token) });
  const info: InviteInfo | null = inviteQuery.data ?? null;
  const accept = useMutation({
    mutationFn: () => api.acceptInvite(token),
    onSuccess: async (house) => {
      await enterHouse(house);
      router.replace('/');
    },
  });
  const busy = accept.isPending;
  const join = () => accept.mutate();
  const error = inviteQuery.error
    ? inviteQuery.error instanceof ApiError && inviteQuery.error.status === 404
      ? 'This invite link is not valid.'
      : inviteQuery.error.message
    : accept.error
      ? accept.error.message
      : null;

  if (error && !info) {
    return (
      <Screen>
        <Banner tone="error">{error}</Banner>
      </Screen>
    );
  }
  if (!info || session.loading) {
    return (
      <Screen>
        <ActivityIndicator color={colors.kraft} style={{ marginTop: space(10) }} />
      </Screen>
    );
  }

  const signedIn = !!session.me?.user;
  return (
    <Screen>
      <Text style={styles.h1}>Join “{info.house_name}”</Text>
      <Card>
        <Text style={styles.body}>
          {info.inviter_name ?? 'Someone'} invited you to their moving boxes. Members can add, search and print boxes for this house.
        </Text>
        {info.status !== 'valid' ? <Banner tone="error">{STATUS_COPY[info.status]}</Banner> : null}
        {error ? <Banner tone="error">{error}</Banner> : null}
        {!signedIn ? (
          <Button label="Sign in to join" big onPress={() => signIn.mutate(`/invite/${token}`)} disabled={info.status !== 'valid'} />
        ) : (
          // Already-members get 200 from accept even if the link was used, so Join stays enabled.
          <Button label="Join" big busy={busy} onPress={join} />
        )}
      </Card>
      {signedIn ? <Text style={styles.muted}>Signed in as {session.me?.user?.name ?? session.me?.user?.email}</Text> : null}
    </Screen>
  );
}
