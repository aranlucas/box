import { FlashList, type ListRenderItem } from '@shopify/flash-list';
import { Image } from 'expo-image';
import { Linking, Pressable, StyleSheet, View } from 'react-native';

import { photoUrl, type Photo } from '@/lib/api';

import { styles } from './components';
import { colors, radius, space } from './theme';

const PHOTO_HEIGHT = 165;
const photoKey = (photo: Photo) => photo.id;

/** A box's photos as a strip of thumbnails; tapping one opens it full size. */
export function Photos({ photos }: { photos: Photo[] }) {
  if (photos.length === 0) {
    return null;
  }
  return (
    <FlashList
      horizontal
      style={s.strip}
      data={photos}
      keyExtractor={photoKey}
      renderItem={renderPhoto}
      ItemSeparatorComponent={PhotoSeparator}
      showsHorizontalScrollIndicator={false}
    />
  );
}

const renderPhoto: ListRenderItem<Photo> = ({ item: photo }) => {
  const uri = photoUrl(photo.id);
  return (
    <Pressable
      accessibilityRole="imagebutton"
      accessibilityLabel="Photo of box contents"
      accessibilityHint="Opens the full-size photo"
      onPress={() => {
        void Linking.openURL(uri);
      }}
      style={({ pressed }) => pressed && styles.pressed}
    >
      <Image
        source={uri}
        style={s.photo}
        contentFit="cover"
        cachePolicy="disk"
        recyclingKey={uri}
        loading="lazy"
      />
    </Pressable>
  );
};

function PhotoSeparator() {
  return <View style={s.separator} />;
}

const s = StyleSheet.create({
  strip: { height: PHOTO_HEIGHT },
  separator: { width: space(2) },
  photo: {
    width: 220,
    height: PHOTO_HEIGHT,
    borderRadius: radius.md,
    backgroundColor: colors.line,
  },
});
