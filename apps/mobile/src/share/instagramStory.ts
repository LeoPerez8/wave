import type { LyricStoryBackground, LyricStoryFrame } from "@wave/core";

/** The native image export and Stories delivery boundary. */
export interface InstagramStoryNative {
  readonly writeStorySticker: (path: string, frame: LyricStoryFrame) => Promise<string>;
  readonly shareToInstagramStory: (
    path: string,
    top: string,
    bottom: string,
    appId: string,
  ) => Promise<void>;
}

/**
 * Lyrics get a separate transparent, padded and rounded PNG before the native
 * intent is opened. The source stays a standalone card for other destinations.
 * Song and Recap shares omit [frame], retaining their existing exports.
 */
export const deliverInstagramStory = async (
  native: InstagramStoryNative,
  path: string,
  background: LyricStoryBackground,
  appId: string,
  frame?: LyricStoryFrame,
): Promise<void> => {
  const sticker = frame === undefined ? path : await native.writeStorySticker(path, frame);
  await native.shareToInstagramStory(sticker, background.top, background.bottom, appId);
};
