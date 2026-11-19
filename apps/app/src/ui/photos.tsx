import { Image } from 'expo-image';
import { Linking, Pressable, ScrollView, StyleSheet } from 'react-native';

import { photoUrl, type Photo } from '@/lib/api';

import { styles } from './components';
import { colors, radius, space } from './theme';

/** A box's photos as a strip of thumbnails; tapping one opens it full size. */
export function Photos({ photos }: { photos: Photo[] }) {
  if (photos.length === 0) {
    return null;
  }
  return (
    <ScrollView
      horizontal
      style={s.strip}
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={s.photos}
    >
      {photos.map((photo) => (
        <Pressable
          key={photo.id}
          accessibilityRole="imagebutton"
          accessibilityLabel="Photo of box contents"
          accessibilityHint="Opens the full-size photo"
          onPress={() => {
            void Linking.openURL(photoUrl(photo.id));
          }}
          style={({ pressed }) => pressed && styles.pressed}
        >
          {/* expo-image keeps photos on disk, so they are downloaded once, not on every visit. */}
          <Image source={photoUrl(photo.id)} style={s.photo} contentFit="cover" transition={150} />
        </Pressable>
      ))}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  strip: { flexGrow: 0 },
  photos: { gap: space(2) },
  photo: { width: 220, height: 165, borderRadius: radius.md, backgroundColor: colors.line },
});
