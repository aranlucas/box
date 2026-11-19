import { Image } from 'expo-image';
import type { Ref } from 'react';

import { photoUrl, type Photo } from '@/lib/api';

type PhotoSize = { width: number; height: number };

export type PhotoGalleryViewerHandle = { goTo: (index: number) => void };

export type PhotoGalleryViewerProps = {
  ref: Ref<PhotoGalleryViewerHandle>;
  photos: Photo[];
  initialIndex: number;
  index: number;
  size: PhotoSize;
  onSelect: (index: number) => void;
};

export function PhotoGalleryImage({
  photo,
  size,
  active,
}: {
  photo: Photo;
  size: PhotoSize;
  active: boolean;
}) {
  return (
    <Image
      source={photoUrl(photo.id)}
      style={size}
      alt={active ? 'Box contents' : ''}
      contentFit="contain"
      cachePolicy="disk"
      recyclingKey={photo.id}
    />
  );
}
