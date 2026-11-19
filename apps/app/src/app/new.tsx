import { useMutation, useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';

import { api, type FormDataPhoto } from '@/lib/api';
import { queries } from '@/lib/queries';
import { useSession } from '@/lib/session';
import { takeBoxPhoto } from '@/lib/photo';
import { Banner, Button, Screen, styles } from '@/ui/components';
import { colors, space } from '@/ui/theme';

export default function NewBox() {
  // The destination house is fixed when "New box" was tapped, not re-read when the photo comes back.
  const params = useLocalSearchParams<{ house?: string }>();
  const session = useSession();
  const houseId = params.house ?? session.house?.id ?? null;
  const houseName = session.me?.houses.find((h) => h.id === houseId)?.name;
  const qc = useQueryClient();
  // Kept so a failed upload can be retried without retaking the photo.
  const [photo, setPhoto] = useState<FormDataPhoto | null>(null);
  const create = useMutation({
    mutationFn: (p: FormDataPhoto) => {
      if (!houseId) {
        throw new Error('Pick a house first.');
      }
      return api.createBox(houseId, p);
    },
    onSuccess: (res) => {
      qc.setQueryData(queries.box(res.box.id).queryKey, res.box);
      void qc.invalidateQueries({ queryKey: queries.allBoxes() });
      router.replace({
        pathname: '/b/[id]',
        params: { id: res.box.id, fresh: res.aiFailed ? 'ai-failed' : '1' },
      });
    },
  });
  const [pickError, setPickError] = useState<string | null>(null);
  const error = pickError ?? (create.error ? create.error.message : null);
  async function go(source: 'camera' | 'library') {
    setPickError(null);
    try {
      const taken = await takeBoxPhoto(source);
      if (taken) {
        setPhoto(taken);
        create.mutate(taken);
      }
    } catch (e) {
      setPickError(e instanceof Error ? e.message : String(e));
    }
  }

  if (create.isPending) {
    return (
      <Screen>
        <View
          style={{
            flex: 1,
            alignItems: 'center',
            justifyContent: 'center',
            gap: space(4),
            paddingVertical: space(20),
          }}
        >
          <ActivityIndicator size="large" color={colors.kraft} />
          <Text style={styles.h2}>Reading the box…</Text>
          <Text style={[styles.muted, { textAlign: 'center' }]}>
            Listing what’s inside and picking a title. This takes a few seconds.
          </Text>
        </View>
      </Screen>
    );
  }

  return (
    <Screen>
      <Text style={styles.body}>
        Take one photo looking into the open box. Spread things out a little so the top layer is
        visible.
      </Text>
      {houseName ? <Text style={styles.muted}>Adding to {houseName}</Text> : null}
      {error ? <Banner tone="error">{error}</Banner> : null}
      {create.isError && photo ? (
        <Button label="Retry upload" onPress={() => create.mutate(photo)} />
      ) : null}
      <Button
        label="Take photo"
        big
        onPress={() => {
          void go('camera');
        }}
      />
      <Button
        label="Choose from photos"
        variant="secondary"
        onPress={() => {
          void go('library');
        }}
      />
    </Screen>
  );
}
