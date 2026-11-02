import {
  releaseAnswerKey,
  releaseTagDate,
  typedReleaseDateOf,
  type ReleaseKeySong,
} from "@wave/core";

import { Storage } from "expo-sqlite/kv-store";
import { useSyncExternalStore } from "react";

import { releaseAnswerStore } from "./releaseAnswerStore";

import { typedReleaseDates } from "./typedReleaseDates";

/**
 * The lookup's answers, by song (Core's `releaseAnswerKey`): provenance and durable retry
 * deadlines. A YT Music entry's date lives only here until the song is downloaded.
 */
const answers = releaseAnswerStore(Storage);
export const releaseAnswers = {
  ...answers,
  useValue: () => useSyncExternalStore(answers.subscribe, answers.get),
};

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
