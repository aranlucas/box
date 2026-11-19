import { useImperativeHandle, useRef } from 'react';
import { Gallery, type GalleryRefType } from 'react-native-zoom-toolkit';

import { PhotoGalleryImage, type PhotoGalleryViewerProps } from './photo-gallery-image';

export function PhotoGalleryViewer({
  ref,
  photos,
  initialIndex,
  index,
  size,
  onSelect,
}: PhotoGalleryViewerProps) {
  const gallery = useRef<GalleryRefType>(null);
  useImperativeHandle(ref, () => ({ goTo: (page) => gallery.current?.setIndex(page) }), []);

  return (
    <Gallery
      ref={gallery}
      data={photos}
      initialIndex={initialIndex}
      keyExtractor={(photo) => photo.id}
      onIndexChange={onSelect}
      renderItem={(photo, page) => (
        <PhotoGalleryImage photo={photo} size={size} active={index === page} />
      )}
    />
  );
}
