import { NativeModule, requireOptionalNativeModule } from "expo";

/**
 * Sharing images Wave draws (`modules/wave-native`, `share/ShareModule.kt`):
 * a PNG written from base64 into the cache, then saved to the gallery or handed
 * to another app through Wave's file provider (`ShareImageProvider`).
 */
declare class WaveShareModule extends NativeModule {
  /** Writes a base64 PNG as `fileName` among the shared images; resolves its path. */
  writeImage(base64: string, fileName: string): Promise<string>;
  /** Copies the shared image at `path` into the gallery (Pictures/Wave). */
  saveToGallery(path: string): Promise<void>;
  /** Opens the share sheet with the shared image at `path`, titled `title`. */
  shareImage(path: string, title: string): Promise<void>;
}

/** Null in a build without it (one from before the lyrics card). */
export const WaveShare = requireOptionalNativeModule<WaveShareModule>("WaveShare");
