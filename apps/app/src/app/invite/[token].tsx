import { useMutation, useQuery } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { Text } from 'react-native';

import { api, displayName, isApiError, type InviteInfo, type InviteStatus } from '@/lib/api';
import { queries } from '@/lib/queries';
import { useEnterHouse, useSession, useSignIn, type Session } from '@/lib/session';
import { Banner, Button, Card, LoadingScreen, Screen, styles } from '@/ui/components';

const UNUSABLE: Record<Exclude<InviteStatus, 'valid'>, string> = {
  used: 'This invite link has already been used. Ask for a new one.',
  expired: 'This invite link has expired. Ask for a new one.',
  revoked: 'This invite link was cancelled. Ask for a new one.',
};

export default function InviteScreen() {
  const { token } = useLocalSearchParams<{ token: string }>();
  const session = useSession();
  const invite = useQuery(queries.invite(token));

  if (invite.data && session.status !== 'loading') {
    return <Invite token={token} info={invite.data} session={session} />;
  }
  if (invite.error) {
    return (
      <Screen>
        <Banner tone="error">
          {isApiError(invite.error, 404) ? 'This invite link is not valid.' : invite.error.message}
        </Banner>
      </Screen>
    );
  }
  return <LoadingScreen />;
}

function Invite({
  token,
  info,
  session,
}: {
  token: string;
  info: InviteInfo;
  session: Exclude<Session, { status: 'loading' }>;
}) {
  const signIn = useSignIn();
  const enterHouse = useEnterHouse();
  const accept = useMutation({
    mutationFn: async () => {
      await enterHouse(await api.acceptInvite(token));
      router.replace('/');
    },
  });
  const problem = accept.error ?? signIn.error;

  return (
    <Screen>
      <Text style={styles.h1} accessibilityRole="header">
        Join “{info.house_name}”
      </Text>
      <Card>
        <Text style={styles.body}>
          {info.inviter_name ?? 'Someone'} invited you to join their house on Box. Members can add,
          search and print boxes for this house.
        </Text>
        {info.status === 'valid' ? null : <Banner tone="error">{UNUSABLE[info.status]}</Banner>}
        {problem ? <Banner tone="error">{problem.message}</Banner> : null}
        {session.status === 'signed-in' ? (
          // Already-members get 200 from accept even if the link was used, so Join stays enabled.
          <Button
            label="Join"
            big
            busy={accept.isPending}
            onPress={() => {
              accept.mutate();
            }}
          />
        ) : (
          <Button
            label="Sign in to join"
            big
            busy={signIn.isPending}
            disabled={info.status !== 'valid'}
            onPress={() => {
              signIn.mutate(`/invite/${token}`);
            }}
          />
        )}
      </Card>
      {session.status === 'signed-in' ? (
        <Text style={styles.muted}>Signed in as {displayName(session.user) ?? 'your account'}</Text>
      ) : null}
    </Screen>
  );
}
