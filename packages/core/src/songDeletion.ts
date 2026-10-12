/**
 * Deleting songs: their audio files go from the phone, and the songs from the
 * library. What the confirmation and the error after a failed delete say.
 */

import type { AlertSpec } from "./alert.ts";

/** Why a file couldn't be deleted. */
export type SongDeleteFailureReason =
  /** It was already gone. */
  | "missing"
  /** Wave isn't allowed to (no all-files access, or the folder refuses it). */
  | "denied"
  /** Its storage is mounted read-only. */
  | "readOnly"
  /** Anything else. */
  | "failed";

export interface SongDeleteFailure {
  readonly title: string;
  readonly reason: SongDeleteFailureReason;
}

/** The alert that asks first, `Delete "Song"?`, with a destructive Delete. */
export const confirmSongDeletion = (
  songs: readonly { readonly title: string }[],
): AlertSpec & { readonly action: NonNullable<AlertSpec["action"]> } => {
  const only = songs.length === 1 ? songs[0] : undefined;
  return {
    title:
      only === undefined
        ? `Delete ${songs.length.toLocaleString("en")} songs?`
        : `Delete “${only.title}”?`,
    message:
      only === undefined
        ? "The files are removed from your phone."
        : "The file is removed from your phone.",
    action: { label: "Delete", destructive: true },
  };
};

const REASONS: Record<SongDeleteFailureReason, string> = {
  missing: "The file is already gone.",
  denied: "Wave isn't allowed to delete it.",
  readOnly: "Its storage is read-only.",
  failed: "The file couldn't be deleted.",
};

/** Songs named one by one in the error for several; the rest are counted. */
const NAMED_FAILURES = 3;

const lowerFirst = (text: string): string =>
  // "Wave" stays capitalised; the other reasons start a clause after the song's name.
  text.startsWith("Wave") ? text : text.charAt(0).toLowerCase() + text.slice(1);

/**
 * The error after deleting [attempted] songs, when some files couldn't be
 * deleted (those songs stay in the library); null when none failed.
 */
export const songDeletionFailure = (
  failures: readonly SongDeleteFailure[],
  attempted: number,
): { readonly title: string; readonly message: string } | null => {
  const [first] = failures;
  if (first === undefined) return null;
  if (attempted === 1 && failures.length === 1) {
    return {
      title: `Couldn't delete “${first.title}”`,
      message: `${REASONS[first.reason]} The song stays in your library.`,
    };
  }
  const named = failures
    .slice(0, NAMED_FAILURES)
    .map((failure) => `“${failure.title}”: ${lowerFirst(REASONS[failure.reason])}`);
  const more = failures.length - NAMED_FAILURES;
  return {
    title: `Couldn't delete ${failures.length.toLocaleString("en")} of ${attempted.toLocaleString("en")} songs`,
    message: [
      failures.length === 1 ? "It stays in your library." : "They stay in your library.",
      ...named,
      ...(more > 0 ? [`And ${more.toLocaleString("en")} more.`] : []),
    ].join("\n"),
  };
};
