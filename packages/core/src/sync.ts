/**
 * Sync: the rules a Wave account syncs by (docs/spec.md, "Wave account and
 * sync"). The app and the sync service both merge with them, so the two sides
 * always agree.
 */

import { UNKNOWN_ALBUM, albumKey } from "./library.ts";
import { normalizeSearchText } from "./search.ts";

/** The tags a song's recording key is built from. A `LibraryTrack` has them all. */
export interface RecordingTags {
  readonly title: string;
  /** The album title; `null`, empty or "Unknown Album" when the file has no album tag. */
  readonly album: string | null;
  readonly albumArtist: string;
  readonly discNumber: number | null;
  readonly trackNumber: number | null;
}

const SEPARATOR = "\u001f";

/**
 * What makes two songs on different phones the same song for a Wave account:
 * the album's identity (title + album artist, as the Library groups albums),
 * the title with case, accents and punctuation aside (as Search compares), and
 * the disc and track number when the file has a track number (no disc counts
 * as disc 1). A song with no album tag keys on its album artist and title.
 *
 * The key is stored on both sides, so changing how it's built is a migration.
 */
export const recordingKey = (song: RecordingTags): string => {
  const album = song.album === null || song.album === UNKNOWN_ALBUM ? "" : song.album;
  const parts = [albumKey(album, song.albumArtist), normalizeSearchText(song.title)];
  if (album !== "" && song.trackNumber !== null) {
    parts.push(`${song.discNumber ?? 1}.${song.trackNumber}`);
  }
  return parts.join(SEPARATOR);
};

/** A song as matching by recording sees it: its key (`recordingKey`) and its length. */
export interface Recording {
  readonly recordingKey: string;
  readonly durationMs: number;
}

/** How far apart two lengths can be for one recording, when length has to break a tie. */
export const RECORDING_LENGTH_TOLERANCE_MS = 3_000;

/**
 * Which of [candidates] is [song]: the one with its recording key. When
 * several have the key, length breaks the tie: the one within 3 seconds of
 * the song's length wins, and none does when that leaves more or fewer than one.
 */
export const findRecording = <C extends Recording>(
  song: Recording,
  candidates: readonly C[],
): C | null => {
  const sameKey = candidates.filter((candidate) => candidate.recordingKey === song.recordingKey);
  if (sameKey.length <= 1) return sameKey[0] ?? null;
  const close = sameKey.filter(
    (candidate) =>
      Math.abs(candidate.durationMs - song.durationMs) <= RECORDING_LENGTH_TOLERANCE_MS,
  );
  return close.length === 1 ? (close[0] ?? null) : null;
};
