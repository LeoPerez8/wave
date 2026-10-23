import type { LyricStoryBackground, LyricStoryFrame } from "@wave/core";

/** The native image export and Stories delivery boundary. */
export interface InstagramStoryNative {
  readonly writeStoryImages: (
    path: string,
    frame: LyricStoryFrame,
    top: string,
    bottom: string,
  ) => Promise<{ sticker: string; background: string }>;
  readonly shareStoryImages: (sticker: string, background: string, appId: string) => Promise<void>;
  readonly shareToInstagramStory: (
    path: string,
    top: string,
    bottom: string,
    appId: string,
  ) => Promise<void>;
}

/**
 * Lyrics get a tight rounded sticker and a separate gradient background PNG
 * before delivery. The source stays a standalone card for other destinations.
 * Song and Recap shares omit [frame], retaining their existing exports.
 */
export const deliverInstagramStory = async (
  native: InstagramStoryNative,
  path: string,
  background: LyricStoryBackground,
  appId: string,
  frame?: LyricStoryFrame,
): Promise<void> => {
  if (frame === undefined) {
    await native.shareToInstagramStory(path, background.top, background.bottom, appId);
    return;
  }
  const images = await native.writeStoryImages(path, frame, background.top, background.bottom);
  await native.shareStoryImages(images.sticker, images.background, appId);
};
