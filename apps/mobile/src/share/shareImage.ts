import { ImageFormat, makeImageFromView } from "@shopify/react-native-skia";
import type { ComponentRef, RefObject } from "react";
import type { View } from "react-native";

import { WaveShare } from "@/native/waveShare";

/** The view to draw: laid out, `collapsable={false}`, with no transform of its own. */
export type ImageSource = RefObject<ComponentRef<typeof View> | null>;

const share = () => {
  if (WaveShare === null) throw new Error("This build of Wave can't share images");
  return WaveShare;
};

/**
 * Draws [view] at its full size in pixels into a PNG named [fileName] among
 * Wave's shared images, and resolves its path for `saveImageToGallery`,
 * `openImageShareSheet` or another destination. The view's images must be
 * software bitmaps (React Native's `Image`, not expo-image's hardware ones),
 * as it's drawn on a software canvas.
 */
export const writeViewPng = async (view: ImageSource, fileName: string): Promise<string> => {
  const native = share();
  // Skia's types predate RN's element refs; at runtime it only needs a ref findNodeHandle accepts.
  const image = await makeImageFromView(view as unknown as Parameters<typeof makeImageFromView>[0]);
  if (image === null) throw new Error("The image wasn't drawn: its view isn't laid out");
  try {
    return await native.writeImage(image.encodeToBase64(ImageFormat.PNG), fileName);
  } finally {
    image.dispose();
  }
};

/** Copies a shared image ([writeViewPng]) into the gallery, in Pictures/Wave. */
export const saveImageToGallery = (path: string): Promise<void> => share().saveToGallery(path);

/** Opens Android's share sheet with a shared image ([writeViewPng]). */
export const openImageShareSheet = (path: string, title: string): Promise<void> =>
  share().shareImage(path, title);
