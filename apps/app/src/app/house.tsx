import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Platform, Pressable, Share, StyleSheet, Text, View } from 'react-native';

import { api, type Member, type PendingInvite } from '@/lib/api';
import { refreshSession, setHouse, useSession } from '@/lib/session-store';
import { Banner, Button, Card, Field, Screen, styles } from '@/ui/components';
import { colors, space } from '@/ui/theme';

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));
const days = (ms: number) => Math.max(1, Math.round((ms - Date.now()) / 86_400_000));

function confirm(title: string, message: string, action: string): Promise<boolean> {
  if (Platform.OS === 'web') return Promise.resolve(window.confirm(`${title}\n\n${message}`));
  return new Promise((resolve) =>
    Alert.alert(title, message, [
      { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
      { text: action, style: 'destructive', onPress: () => resolve(true) },
    ]),
  );
}

export default function HouseScreen() {
  const session = useSession();
  const house = session.house;
  const me = session.me?.user;
  const [members, setMembers] = useState<Member[] | null>(null);
  const [invites, setInvites] = useState<PendingInvite[]>([]);
  const [link, setLink] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [newHouse, setNewHouse] = useState('');

  const load = useCallback(async () => {
    if (!house) return;
    try {
      const r = await api.members(house.id);
      setMembers(r.members);
      setInvites(r.invites);
    } catch (e) {
      setError(errMsg(e));
    }
  }, [house]);

  useEffect(() => {
    load();
  }, [load]);

  if (!house || !me) {
    return (
      <Screen>
        <Banner>Sign in and pick a house first.</Banner>
      </Screen>
    );
  }
  const isOwner = house.role === 'owner';

  async function invite() {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const { url } = await api.createInvite(house!.id);
      setLink(url);
      const message = `Join “${house!.name}” on Moving Boxes: ${url}`;
      if (Platform.OS === 'web') {
        const nav = navigator as Navigator & { share?: (d: ShareData) => Promise<void> };
        if (nav.share) await nav.share({ title: 'Moving Boxes invite', text: message, url }).catch(() => {});
        else if (nav.clipboard) {
          await nav.clipboard.writeText(url);
          setNotice('Invite link copied. It works once and expires in 7 days.');
        }
      } else {
        await Share.share({ message });
      }
      await load();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  async function remove(m: Member) {
    const self = m.user_id === me!.id;
    const ok = await confirm(
      self ? 'Leave house' : 'Remove member',
      self ? `Leave “${house!.name}”? You’ll need a new invite to come back.` : `Remove ${m.name ?? m.email} from “${house!.name}”?`,
      self ? 'Leave' : 'Remove',
    );
    if (!ok) return;
    try {
      await api.removeMember(house!.id, m.user_id);
      if (self) {
        await refreshSession();
        router.replace('/');
      } else await load();
    } catch (e) {
      setError(errMsg(e));
    }
  }

  async function createHouse() {
    const name = newHouse.trim();
    if (!name) return;
    try {
      const h = await api.createHouse(name);
      await refreshSession();
      await setHouse(h.id);
      router.replace('/');
    } catch (e) {
      setError(errMsg(e));
    }
  }

  return (
    <Screen>
      <View style={{ gap: space(1) }}>
        <Text style={s.kicker}>{isOwner ? 'You own this house' : 'Member'}</Text>
        <Text style={styles.h1}>{house.name}</Text>
      </View>

      {error ? <Banner tone="error">{error}</Banner> : null}
      {notice ? <Banner tone="success">{notice}</Banner> : null}

      {isOwner ? (
        <Card>
          <Text style={styles.h2}>Invite someone</Text>
          <Text style={styles.body}>
            Send a link by text or chat. It works once and expires in 7 days. They’ll sign in, then tap Join.
          </Text>
          <Button label="Create invite link" busy={busy} onPress={invite} />
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
                    onPress={async () => {
                      await api.revokeInvite(house.id, i.id).catch((e) => setError(errMsg(e)));
                      load();
                    }}
                  />
                </View>
              ))}
            </View>
          ) : null}
        </Card>
      ) : null}

      <Card>
        <Text style={styles.h2}>People</Text>
        {!members
          ? null
          : members.map((m) => (
              <View key={m.user_id} style={[styles.row, { justifyContent: 'space-between' }]}>
                <View style={{ flexShrink: 1 }}>
                  <Text style={styles.body}>
                    {m.name ?? m.email}
                    {m.user_id === me.id ? ' (you)' : ''}
                  </Text>
                  <Text style={styles.muted}>{m.role === 'owner' ? 'Owner' : 'Member'}</Text>
                </View>
                {isOwner || m.user_id === me.id ? (
                  <Pressable onPress={() => remove(m)} accessibilityRole="button">
                    <Text style={{ color: colors.red, fontWeight: '600' }}>{m.user_id === me.id ? 'Leave' : 'Remove'}</Text>
                  </Pressable>
                ) : null}
              </View>
            ))}
      </Card>

      {isOwner ? (
        <Card>
          <Text style={styles.h2}>Another house</Text>
          <Text style={styles.muted}>For a second home, storage unit or garage. Box numbers start at 1 in each house.</Text>
          <Field value={newHouse} onChangeText={setNewHouse} placeholder="e.g. Storage unit" onSubmitEditing={createHouse} />
          <Button label="Create house" variant="secondary" disabled={!newHouse.trim()} onPress={createHouse} />
        </Card>
      ) : null}
    </Screen>
  );
}

const s = StyleSheet.create({
  kicker: { fontSize: 14, fontWeight: '700', color: colors.kraftDark, textTransform: 'uppercase', letterSpacing: 0.8 },
  link: { fontSize: 14, color: colors.kraftDark, backgroundColor: colors.kraftSoft, padding: space(2), borderRadius: 8 },
});
