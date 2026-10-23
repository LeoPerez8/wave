import type { LyricStoryFrame } from "@wave/core";
import { NativeModule, requireOptionalNativeModule } from "expo";

/**
 * Sharing images Wave draws (`modules/wave-native`, `share/ShareModule.kt`):
 * a PNG written from base64 into the cache, then saved to the gallery or handed
 * to another app through Wave's file provider (`ShareImageProvider`).
 */
declare class WaveShareModule extends NativeModule {
  /** Writes a base64 PNG as `fileName` among the shared images; resolves its path. */
  writeImage(base64: string, fileName: string): Promise<string>;
  /** Writes a tight rounded sticker and a full Story gradient; leaves the source card intact. */
  writeStoryImages(
    path: string,
    frame: LyricStoryFrame,
    top: string,
    bottom: string,
  ): Promise<{ sticker: string; background: string }>;
  /** Sends the separate sticker and background images to Instagram's Stories editor. */
  shareStoryImages(sticker: string, background: string, appId: string): Promise<void>;
  /** Copies the shared image at `path` into the gallery (Pictures/Wave). */
  saveToGallery(path: string): Promise<void>;
  /** Opens the share sheet with the shared image at `path`, titled `title`. */
  shareImage(path: string, title: string): Promise<void>;
  /** Which apps a shared image can go straight to (installed and taking it). */
  shareApps(): Promise<{ instagramStories: boolean; whatsapp: boolean }>;
  /**
   * Opens Instagram's Stories editor with the shared image at `path` as a sticker over a
   * `top` to `bottom` background (`#rrggbb`); `appId` is the build's Facebook App ID.
   */
  shareToInstagramStory(path: string, top: string, bottom: string, appId: string): Promise<void>;
  /** Sends the shared image at `path` straight to WhatsApp's share flow. */
  shareToWhatsApp(path: string): Promise<void>;
}

/** Null in a build without it (one from before the lyrics card). */
export const WaveShare = requireOptionalNativeModule<WaveShareModule>("WaveShare");
