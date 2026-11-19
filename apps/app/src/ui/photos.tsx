import { FlashList } from '@shopify/flash-list';
import { Image } from 'expo-image';
import { useRef, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaView } from 'react-native-safe-area-context';

import { photoUrl, type Photo } from '@/lib/api';

import { Button, styles } from './components';
import type { PhotoGalleryViewerHandle } from './photo-gallery-image';
import { PhotoGalleryViewer } from './photo-gallery-viewer';
import { colors, radius, space } from './theme';

const PHOTO_HEIGHT = 165;
const photoKey = (photo: Photo) => photo.id;
const photoLabel = (index: number, total: number) => `Photo ${index + 1} of ${total}`;

/** A thumbnail strip that opens the selected photo in the box's gallery. */
export function Photos({ photos }: { photos: Photo[] }) {
  const [openingPhotoId, setOpeningPhotoId] = useState<string>();
  if (photos.length === 0) {
    return null;
  }

  const initialIndex = photos.findIndex((photo) => photo.id === openingPhotoId);

  return (
    <>
      <FlashList
        horizontal
        style={s.strip}
        data={photos}
        keyExtractor={photoKey}
        renderItem={({ item, index }) => (
          <PhotoThumbnail
            photo={item}
            label={photoLabel(index, photos.length)}
            onPress={() => setOpeningPhotoId(item.id)}
          />
        )}
        ItemSeparatorComponent={PhotoSeparator}
        showsHorizontalScrollIndicator={false}
      />
      {initialIndex >= 0 ? (
        <PhotoGallery
          photos={photos}
          initialIndex={initialIndex}
          onClose={() => setOpeningPhotoId(undefined)}
        />
      ) : null}
    </>
  );
}

function PhotoGallery({
  photos,
  initialIndex,
  onClose,
}: {
  photos: Photo[];
  initialIndex: number;
  onClose: () => void;
}) {
  const [index, setIndex] = useState(initialIndex);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const viewer = useRef<PhotoGalleryViewerHandle>(null);

  return (
    <Modal accessibilityLabel="Box photos" onRequestClose={onClose}>
      <SafeAreaView style={s.gallery} accessibilityViewIsModal>
        <View style={s.galleryContent}>
          <View style={s.galleryHeader}>
            <Text style={styles.h2} accessibilityRole="header" aria-live="polite">
              {photoLabel(index, photos.length)}
            </Text>
            <Button label="Close" variant="secondary" onPress={onClose} />
          </View>
          <View
            style={s.galleryStage}
            onLayout={({
              nativeEvent: {
                layout: { width, height },
              },
            }) => setSize({ width, height })}
          >
            <GestureHandlerRootView>
              {size.width > 0 && size.height > 0 ? (
                <PhotoGalleryViewer
                  ref={viewer}
                  photos={photos}
                  initialIndex={initialIndex}
                  index={index}
                  size={size}
                  onSelect={setIndex}
                />
              ) : null}
            </GestureHandlerRootView>
          </View>
          {photos.length > 1 ? (
            <View style={s.galleryNav}>
              <Button
                label="Previous"
                variant="secondary"
                disabled={index === 0}
                onPress={() => viewer.current?.goTo(index - 1)}
              />
              <Button
                label="Next"
                variant="secondary"
                disabled={index >= photos.length - 1}
                onPress={() => viewer.current?.goTo(index + 1)}
              />
            </View>
          ) : null}
        </View>
      </SafeAreaView>
    </Modal>
  );
}

function PhotoThumbnail({
  photo,
  label,
  onPress,
}: {
  photo: Photo;
  label: string;
  onPress: () => void;
}) {
  const uri = photoUrl(photo.id);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint="Opens the photo gallery"
      onPress={onPress}
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
}

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
  gallery: { flex: 1, backgroundColor: colors.bg },
  galleryContent: {
    flex: 1,
    alignSelf: 'center',
    width: '100%',
    maxWidth: 1120,
    padding: space(4),
    gap: space(3),
  },
  galleryHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space(3),
  },
  galleryStage: {
    flex: 1,
    borderRadius: radius.md,
    overflow: 'hidden',
    backgroundColor: colors.ink,
  },
  galleryNav: { flexDirection: 'row', justifyContent: 'center', gap: space(3) },
});
