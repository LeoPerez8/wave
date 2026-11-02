import {
  readReleaseAnswers,
  releaseAnswerKey,
  releaseTagDate,
  typedReleaseDateOf,
  type ReleaseAnswer,
  type ReleaseKeySong,
} from "@wave/core";

import { persistedSetting } from "@/lib/persistedSetting";

import { typedReleaseDates } from "./typedReleaseDates";

/**
 * The lookup's answers, by song (Core's `releaseAnswerKey`): provenance and durable retry
 * deadlines. A YT Music entry's date lives only here until the song is downloaded.
 */
export const releaseAnswers = persistedSetting<Readonly<Record<string, ReleaseAnswer>>>({
  key: "releaseDates.answers",
  read: readReleaseAnswers,
  write: JSON.stringify,
});

/**
 * The date a download of [song] writes into its new file: one the owner typed, else a
 * first-release date the lookup found (Core's `releaseTagDate`).
 */
export const downloadReleaseDate = (song: ReleaseKeySong): string | null =>
  typedReleaseDateOf(typedReleaseDates.get(), song) ??
  releaseTagDate({
    answer: releaseAnswers.get()[releaseAnswerKey(song)],
    held: null,
    hasFile: true,
  });
