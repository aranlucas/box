import { useMutation, useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { api, type FormDataPhoto, type House } from '@/lib/api';
import { refreshHouseBoxes } from '@/lib/boxes';
import { takeBoxPhoto } from '@/lib/photo';
import { queries } from '@/lib/queries';
import { useSession } from '@/lib/session';
import { Banner, Button, LoadingScreen, Screen, styles } from '@/ui/components';
import { colors, space } from '@/ui/theme';

export default function NewBoxScreen() {
  // The destination house is fixed when "New box" was tapped, not re-read when the photo comes back.
  const { house: requested } = useLocalSearchParams<{ house?: string }>();
  const session = useSession();
  if (session.status === 'loading') {
    return <LoadingScreen />;
  }
  // Opened without a house in the link (or with one this user has left): use the current house.
  const house =
    session.status === 'signed-in'
      ? (session.houses.find((h) => h.id === requested) ?? session.house)
      : undefined;
  if (!house) {
    return (
      <Screen>
        <Banner>Pick a house first.</Banner>
      </Screen>
    );
  }
  return <NewBox house={house} />;
}

function NewBox({ house }: { house: House }) {
  const qc = useQueryClient();
  // Kept so a failed upload can be retried without retaking the photo.
  const [photo, setPhoto] = useState<FormDataPhoto>();

  const upload = useMutation({
    mutationFn: (taken: FormDataPhoto) => api.createBox(house.id, taken),
    onSuccess: ({ box, aiFailed }) => {
      qc.setQueryData(queries.box(box.id).queryKey, box);
      void refreshHouseBoxes(qc, box.house_id);
      router.replace({
        pathname: '/b/[id]',
        params: { id: box.id, fresh: aiFailed ? 'ai-failed' : '1' },
      });
    },
  });
  const pick = useMutation({
    mutationFn: takeBoxPhoto,
    onSuccess: (taken) => {
      // Closed the camera without taking one
      if (!taken) {
        return;
      }
      setPhoto(taken);
      upload.mutate(taken);
    },
  });
  const problem = pick.error ?? upload.error;

  if (upload.isPending) {
    return (
      <Screen>
        <View style={s.reading}>
          <ActivityIndicator size="large" color={colors.kraft} />
          <Text style={styles.h2}>Reading the box…</Text>
          <Text style={[styles.muted, styles.center]}>
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
      <Text style={styles.muted}>Adding to {house.name}</Text>
      {problem ? <Banner tone="error">{problem.message}</Banner> : null}
      {upload.isError && photo ? (
        <Button
          label="Retry upload"
          onPress={() => {
            upload.mutate(photo);
          }}
        />
      ) : null}
      <Button
        label="Take photo"
        big
        busy={pick.isPending && pick.variables === 'camera'}
        onPress={() => {
          pick.mutate('camera');
        }}
      />
      <Button
        label="Choose from photos"
        variant="secondary"
        busy={pick.isPending && pick.variables === 'library'}
        onPress={() => {
          pick.mutate('library');
        }}
      />
    </Screen>
  );
}

const s = StyleSheet.create({
  reading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: space(4),
    paddingVertical: space(20),
  },
});
