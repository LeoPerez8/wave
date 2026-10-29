/**
 * Deleting songs: their audio files go from the phone, and the songs from the
 * library. What the confirmation and the error after a failed delete say.
 */

import type { AlertSpec } from "./alert.ts";
import { en, type Catalogue } from "./catalogueEn.ts";

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

/**
 * The alert that asks first, `Delete "Song"?`, with a destructive Delete.
 * [signedIn] to a Wave account, the songs leave the account too.
 */
export const confirmSongDeletion = (
  songs: readonly { readonly title: string }[],
  { signedIn = false }: { readonly signedIn?: boolean } = {},
  strings: Catalogue = en,
): AlertSpec & { readonly action: NonNullable<AlertSpec["action"]> } => {
  const text = strings.songDeletion;
  const only = songs.length === 1 ? songs[0] : undefined;
  const message = text.deleteMessage;
  return {
    title: only === undefined ? text.deleteSongs(songs.length) : text.deleteSong(only.title),
    message:
      only === undefined
        ? signedIn
          ? message.severalSignedIn
          : message.several
        : signedIn
          ? message.oneSignedIn
          : message.one,
    action: { label: text.delete, destructive: true },
  };
};

/**
 * The alert that asks before missing songs (no file on this phone) leave the
 * Library, `Remove "Song" from your Library?`: they leave the Wave account
 * too, and the other phones at their next pull, except a phone that has the
 * file, as a pull never takes a file's song away.
 */
export const confirmSongRemoval = (
  songs: readonly { readonly title: string }[],
  strings: Catalogue = en,
): AlertSpec & { readonly action: NonNullable<AlertSpec["action"]> } => {
  const text = strings.songDeletion;
  const only = songs.length === 1 ? songs[0] : undefined;
  return {
    title: only === undefined ? text.removeSongs(songs.length) : text.removeSong(only.title),
    message: only === undefined ? text.removeMessage.several : text.removeMessage.one,
    action: { label: text.remove, destructive: true },
  };
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
  strings: Catalogue = en,
): { readonly title: string; readonly message: string } | null => {
  const text = strings.songDeletion;
  const [first] = failures;
  if (first === undefined) return null;
  if (attempted === 1 && failures.length === 1) {
    return {
      title: text.couldntDeleteSong(first.title),
      message: `${text.reasons[first.reason]} ${text.songStays}`,
    };
  }
  const named = failures
    .slice(0, NAMED_FAILURES)
    .map((failure) => `“${failure.title}”: ${lowerFirst(text.reasons[failure.reason])}`);
  const more = failures.length - NAMED_FAILURES;
  return {
    title: text.couldntDeleteSongs(failures.length, attempted),
    message: [
      failures.length === 1 ? text.oneStays : text.severalStay,
      ...named,
      ...(more > 0 ? [text.more(more)] : []),
    ].join("\n"),
  };
};
