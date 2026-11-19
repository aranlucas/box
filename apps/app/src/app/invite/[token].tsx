import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Text } from 'react-native';

import { api, type InviteInfo } from '@/lib/api';
import { refreshSession, setHouse, signIn, useSession } from '@/lib/session-store';
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
  const [info, setInfo] = useState<InviteInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api
      .inviteInfo(token)
      .then(setInfo)
      .catch((e) => setError(e?.status === 404 ? 'This invite link is not valid.' : String(e?.message ?? e)));
  }, [token]);

  async function join() {
    setBusy(true);
    setError(null);
    try {
      const house = await api.acceptInvite(token);
      await refreshSession();
      await setHouse(house.id);
      router.replace('/');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

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
          <Button label="Sign in to join" big onPress={() => signIn(`/invite/${token}`)} disabled={info.status !== 'valid'} />
        ) : (
          // Already-members get 200 from accept even if the link was used, so Join stays enabled.
          <Button label="Join" big busy={busy} onPress={join} />
        )}
      </Card>
      {signedIn ? <Text style={styles.muted}>Signed in as {session.me?.user?.name ?? session.me?.user?.email}</Text> : null}
    </Screen>
  );
}
