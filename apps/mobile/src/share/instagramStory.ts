import type { LyricStoryBackground, LyricStoryFrame } from "@wave/core";

import type { StoryImages } from "../native/waveShare.ts";

/** The native image export and Stories delivery boundary (`WaveShare`). */
export interface InstagramStoryNative {
  readonly writeStoryImages: (
    path: string,
    frame: LyricStoryFrame,
    background: LyricStoryBackground,
  ) => Promise<StoryImages>;
  readonly shareStoryImages: (sticker: string, background: string, appId: string) => Promise<void>;
  readonly shareToInstagramStory: (
    path: string,
    background: LyricStoryBackground,
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
    await native.shareToInstagramStory(path, background, appId);
    return;
  }
  const images = await native.writeStoryImages(path, frame, background);
  await native.shareStoryImages(images.sticker, images.background, appId);
};
