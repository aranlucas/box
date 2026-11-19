import { router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';

import { api } from '@/lib/api';
import { takeBoxPhoto } from '@/lib/photo';
import { Banner, Button, Screen, styles } from '@/ui/components';
import { colors, space } from '@/ui/theme';

export default function NewBox() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function go(source: 'camera' | 'library') {
    setError(null);
    try {
      const photo = await takeBoxPhoto(source);
      if (!photo) return;
      setBusy(true);
      const { box, aiFailed } = await api.createBox(photo);
      router.replace({ pathname: '/b/[id]', params: { id: box.id, fresh: aiFailed ? 'ai-failed' : '1' } });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  if (busy) {
    return (
      <Screen>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: space(4), paddingVertical: space(20) }}>
          <ActivityIndicator size="large" color={colors.kraft} />
          <Text style={styles.h2}>Reading the box…</Text>
          <Text style={[styles.muted, { textAlign: 'center' }]}>Listing what’s inside and picking a title. This takes a few seconds.</Text>
        </View>
      </Screen>
    );
  }

  return (
    <Screen>
      <Text style={styles.body}>
        Take one photo looking into the open box. Spread things out a little so the top layer is visible.
      </Text>
      {error ? <Banner tone="error">{error}</Banner> : null}
      <Button label="Take photo" big onPress={() => go('camera')} />
      <Button label="Choose from photos" variant="secondary" onPress={() => go('library')} />
    </Screen>
  );
}
