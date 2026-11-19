import { useQuery } from '@tanstack/react-query';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { Text, View } from 'react-native';

import { isApiError, type Box } from '@/lib/api';
import { queries } from '@/lib/queries';
import { BoxEditor, type Fresh } from '@/ui/box-editor';
import { Banner, BoxKicker, Button, Card, LoadingScreen, Screen, styles } from '@/ui/components';
import { Photos } from '@/ui/photos';

export default function BoxScreen() {
  // `fresh` is set by the New box screen, for the hint shown on a box that was just made.
  const { id, fresh } = useLocalSearchParams<{ id: string; fresh?: Fresh }>();
  const { data: box, error } = useQuery(queries.box(id.toUpperCase()));

  if (!box) {
    return error ? <BoxMissing error={error} /> : <LoadingScreen />;
  }
  return (
    <>
      <Stack.Screen options={{ title: `Box #${box.number}` }} />
      {/* The server decides who may edit: members of the box's house. Everyone else just reads the list. */}
      {box.can_edit ? <BoxEditor box={box} fresh={fresh} /> : <BoxContents box={box} />}
    </>
  );
}

function BoxMissing({ error }: { error: Error }) {
  return (
    <Screen>
      <Banner tone="error">
        {isApiError(error, 404) ? 'This box does not exist (or was deleted).' : error.message}
      </Banner>
      <Button
        label="Go to your boxes"
        variant="secondary"
        onPress={() => {
          router.replace('/');
        }}
      />
    </Screen>
  );
}

/** What someone sees after scanning a label: the contents, read-only. */
function BoxContents({ box }: { box: Box }) {
  return (
    <Screen>
      <View style={styles.heading}>
        <BoxKicker box={box} />
        <Text style={styles.h1} accessibilityRole="header">
          {box.title}
        </Text>
      </View>
      <Card>
        {box.items.length === 0 ? <Text style={styles.muted}>No items listed.</Text> : null}
        {box.items.map((item) => (
          <Text key={item.id} style={styles.body}>
            • {item.name}
            {item.quantity ? `  ×${item.quantity}` : ''}
          </Text>
        ))}
        {box.notes ? <Text style={styles.muted}>{box.notes}</Text> : null}
      </Card>
      <Photos photos={box.photos} />
    </Screen>
  );
}
