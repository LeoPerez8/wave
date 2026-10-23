import { ImageFormat, makeImageFromView } from "@shopify/react-native-skia";
import {
  instagramStoriesAppId,
  type LyricShareApps,
  type LyricStoryBackground,
  type LyricStoryFrame,
} from "@wave/core";
import Constants from "expo-constants";
import type { ComponentRef, RefObject } from "react";
import type { View } from "react-native";

import { WaveShare } from "@/native/waveShare";

import { deliverInstagramStory } from "./instagramStory";

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

/**
 * The Facebook App ID Instagram's Stories intent needs (app.config.ts extra);
 * null on a build without one, which has no Instagram Stories destination.
 */
const INSTAGRAM_APP_ID = instagramStoriesAppId(Constants.expoConfig?.extra);

/**
 * Which apps a shared image can go straight to on this phone: Instagram
 * Stories (installed, and the build has an App ID) and WhatsApp (installed).
 * None on a build without the share module, or when the check fails.
 */
export const imageShareApps = async (): Promise<LyricShareApps> => {
  const none = { instagramStories: false, whatsapp: false };
  if (WaveShare === null) return none;
  try {
    const apps = await WaveShare.shareApps();
    return {
      instagramStories: apps.instagramStories && INSTAGRAM_APP_ID !== null,
      whatsapp: apps.whatsapp,
    };
  } catch {
    return none;
  }
};

/**
 * Opens Instagram's Stories editor with a shared image ([writeViewPng]) as a
 * sticker the user can move and resize, over [background].
 */
export const shareImageToInstagramStory = async (
  path: string,
  background: LyricStoryBackground,
  frame?: LyricStoryFrame,
): Promise<void> => {
  if (INSTAGRAM_APP_ID === null) throw new Error("This build has no Facebook App ID for Instagram");
  await deliverInstagramStory(share(), path, background, INSTAGRAM_APP_ID, frame);
};

/** Sends a shared image ([writeViewPng]) straight to WhatsApp's share flow. */
export const shareImageToWhatsApp = (path: string): Promise<void> => share().shareToWhatsApp(path);
