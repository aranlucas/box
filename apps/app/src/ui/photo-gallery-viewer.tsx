import PagerView, { type PagerViewRef } from '@expo/ui/community/pager-view';
import { useImperativeHandle, useRef } from 'react';
import { SnapbackZoom } from 'react-native-zoom-toolkit';

import { PhotoGalleryImage, type PhotoGalleryViewerProps } from './photo-gallery-image';

export function PhotoGalleryViewer({
  ref,
  photos,
  initialIndex,
  index,
  size,
  onSelect,
}: PhotoGalleryViewerProps) {
  const pager = useRef<PagerViewRef>(null);
  useImperativeHandle(ref, () => ({ goTo: (page) => pager.current?.setPage(page) }), []);

  return (
    <PagerView
      ref={pager}
      initialPage={initialIndex}
      scrollEnabled={photos.length > 1}
      onPageSelected={(event) => onSelect(event.nativeEvent.position)}
    >
      {photos.map((photo, page) => (
        <SnapbackZoom key={photo.id} minScale={1}>
          <PhotoGalleryImage photo={photo} size={size} active={index === page} />
        </SnapbackZoom>
      ))}
    </PagerView>
  );
}
