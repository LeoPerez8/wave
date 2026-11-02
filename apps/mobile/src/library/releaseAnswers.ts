import { artistPhotoName, releaseTagDate, type ReleaseAnswer, type ReleaseSong } from "@wave/core";
import { persistedSetting } from "@/lib/persistedSetting";

import { typedReleaseDates } from "./typedReleaseDates";

const readObject = <T>(stored: string | null, fallback: T): T => {
  try {
    return stored ? (JSON.parse(stored) as T) : fallback;
  } catch {
    return fallback;
  }
};
/**
 * The lookup's answers, by song: provenance and durable retry deadlines. A YT Music entry's date
 * lives only here until the song is downloaded.
 */
export const releaseDates = persistedSetting<Record<string, ReleaseAnswer>>({
  key: "releaseDates.answers",
  read: (s) => readObject(s, {}),
  write: JSON.stringify,
});
/** The key [song]'s answer is kept under: its title and artist, loosely matched. */
export const releaseSongKey = (song: ReleaseSong): string =>
  JSON.stringify([artistPhotoName(song.title), artistPhotoName(song.artist)]);
/**
 * The date a download of [song] writes into its new file: one the owner typed, else a
 * first-release date the lookup found (Core's `releaseTagDate`).
 */
export const downloadReleaseDate = (song: ReleaseSong): string | null =>
  typedReleaseDates.get()[releaseSongKey(song)] ??
  releaseTagDate({ answer: releaseDates.get()[releaseSongKey(song)], held: null, hasFile: true });
