import { useMutation, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';

import { api, type FormDataPhoto } from '@/lib/api';
import { queries } from '@/lib/queries';
import { useSession } from '@/lib/session';
import { takeBoxPhoto } from '@/lib/photo';
import { Banner, Button, Screen, styles } from '@/ui/components';
import { colors, space } from '@/ui/theme';

export default function NewBox() {
  const { house } = useSession();
  const qc = useQueryClient();
  const create = useMutation({
    mutationFn: (photo: FormDataPhoto) => {
      if (!house) throw new Error('Pick a house first.');
      return api.createBox(house.id, photo);
    },
    onSuccess: (res) => {
      qc.setQueryData(queries.box(res.box.id).queryKey, res.box);
      qc.invalidateQueries({ queryKey: queries.allBoxes() });
      router.replace({ pathname: '/b/[id]', params: { id: res.box.id, fresh: res.aiFailed ? 'ai-failed' : '1' } });
    },
  });
  const [pickError, setPickError] = useState<string | null>(null);
  const error = pickError ?? (create.error ? create.error.message : null);
  async function go(source: 'camera' | 'library') {
    setPickError(null);
    try {
      const photo = await takeBoxPhoto(source);
      if (photo) create.mutate(photo);
    } catch (e) {
      setPickError(e instanceof Error ? e.message : String(e));
    }
  }

  if (create.isPending) {
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
