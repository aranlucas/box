import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { Platform } from 'react-native';

import type { FormDataPhoto } from './api';

const LONG_EDGE = 1600;

/** Opens the camera (or the library), then downsizes to ~1600px JPEG for a fast upload. */
export async function takeBoxPhoto(source: 'camera' | 'library' = 'camera'): Promise<FormDataPhoto | null> {
  if (Platform.OS !== 'web' && source === 'camera') {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) throw new Error('Camera permission is needed to photograph boxes.');
  }
  const opts: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 1, exif: false };
  const result =
    source === 'camera' ? await ImagePicker.launchCameraAsync(opts) : await ImagePicker.launchImageLibraryAsync(opts);
  if (result.canceled || !result.assets[0]) return null;
  const asset = result.assets[0];

  const landscape = asset.width >= asset.height;
  const ctx = ImageManipulator.manipulate(asset.uri);
  if (Math.max(asset.width, asset.height) > LONG_EDGE) {
    ctx.resize(landscape ? { width: LONG_EDGE } : { height: LONG_EDGE });
  }
  const image = await ctx.renderAsync();
  const saved = await image.saveAsync({ format: SaveFormat.JPEG, compress: 0.8 });

  if (Platform.OS === 'web') {
    const blob = await (await fetch(saved.uri)).blob();
    return { blob };
  }
  return { uri: saved.uri };
}
