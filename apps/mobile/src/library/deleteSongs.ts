import {
  confirmSongDeletion,
  confirmSongRemoval,
  songDeletionFailure,
  type SongDeleteFailureReason,
} from "@wave/core";
import * as Effect from "effect/Effect";

import { currentLocalisation } from "@/localisation/localisation";
import { WaveAccount } from "@/native/waveAccount";
import { confirmAction, showMessage } from "@/overlay/alert";
import { Queue } from "@/playback/Queue";

import { forgetFavorites } from "./favorites";
import { deleteFilesOrFailed } from "./fileDeletions";
import { libraryEdited } from "./LibraryScan";
import { LibraryStore } from "./LibraryStore";
import { appRuntime } from "./runtime";

/** What deleting a song needs to know about it (any `SongRow` will do). */
export interface DeletableSong {
  readonly id: number;
  readonly path: string;
  readonly title: string;
}

/** What `deleteSongs` did: the songs whose files are gone, and those it couldn't delete. */
export interface SongsDeleted<S extends DeletableSong> {
  readonly deleted: readonly S[];
  readonly failed: readonly { readonly song: S; readonly reason: SongDeleteFailureReason }[];
}

/**
 * Deletes the songs' audio files (and sidecar `.lrc` files) from the phone,
 * without asking. The songs whose files are gone leave the library and,
 * signed in, the Wave account (`leaveLibrary`). Songs whose files couldn't be
 * deleted stay as they were.
 */
export const deleteSongs = <S extends DeletableSong>(
  songs: readonly S[],
): Promise<SongsDeleted<S>> =>
  appRuntime.runPromise(
    Effect.gen(function* () {
      const outcomes = yield* deleteFilesOrFailed(
        songs.map((song) => song.path),
        null,
      );
      const deleted: S[] = [];
      const failed: { song: S; reason: SongDeleteFailureReason }[] = [];
      songs.forEach((song, i) => {
        const outcome = outcomes[i] ?? "failed";
        if (outcome === "deleted") deleted.push(song);
        else failed.push({ song, reason: outcome });
      });
      if (deleted.length === 0) return { deleted, failed };

      yield* leaveLibrary(deleted.map((song) => song.id));
      return { deleted, failed };
    }),
  );

/**
 * Takes the songs [ids] out of the Library and, signed in, out of the Wave
 * account: every playlist, Favorites and the queue lose them too (the
 * playing one moves on to the next); their play history stays.
 */
const leaveLibrary = (ids: readonly number[]) =>
  Effect.gen(function* () {
    const store = yield* LibraryStore;
    const queue = yield* Queue;
    // Playlist items and stars go with the tracks (foreign keys); history doesn't.
    yield* store.removeSongs(ids).pipe(Effect.ensuring(Effect.sync(() => libraryEdited(ids))));
    forgetFavorites(ids);
    yield* queue.dispatch({ type: "removeTracks", trackIds: ids.map(String) });
  });

/** Whether the phone is signed in to a Wave account, which deleted songs leave too. */
const signedIn = (): Promise<boolean> =>
  WaveAccount.session().then(
    (session) => session.status === "signedIn",
    () => false,
  );

/**
 * Asks first ("Remove "Song" from your Library?"), then takes missing songs
 * (no file on this phone) out of the Library and the Wave account. [onConfirm]
 * runs once the user confirms (the selection bar ends selection mode there).
 */
export const confirmRemoveSongs = async (
  songs: readonly { readonly id: number; readonly title: string }[],
  { onConfirm }: { readonly onConfirm?: (() => void) | undefined } = {},
): Promise<void> => {
  if (songs.length === 0) return;
  const { strings } = currentLocalisation();
  if (!(await confirmAction(confirmSongRemoval(songs, strings)))) return;
  onConfirm?.();
  try {
    await appRuntime.runPromise(leaveLibrary(songs.map((song) => song.id)));
  } catch (cause) {
    await showMessage(
      strings.songDeletion.couldntRemoveSongs,
      cause instanceof Error ? cause.message : String(cause),
    );
  }
};

/**
 * Asks first ("Delete "Song"?", "Delete 12 songs?"), then deletes the songs
 * (`deleteSongs`) and says how many couldn't be deleted, in one error.
 * [onConfirm] runs once the user confirms, before the files go (the selection
 * bar ends selection mode there, so Cancel keeps it). Resolves with the songs
 * deleted: none when cancelled.
 */
export const confirmDeleteSongs = async <S extends DeletableSong>(
  songs: readonly S[],
  { onConfirm }: { readonly onConfirm?: (() => void) | undefined } = {},
): Promise<readonly S[]> => {
  if (songs.length === 0) return [];
  const signedInNow = await signedIn();
  const { strings } = currentLocalisation();
  if (!(await confirmAction(confirmSongDeletion(songs, { signedIn: signedInNow }, strings))))
    return [];
  onConfirm?.();
  try {
    const { deleted, failed } = await deleteSongs(songs);
    const error = songDeletionFailure(
      failed.map(({ song, reason }) => ({ title: song.title, reason })),
      songs.length,
      strings,
    );
    if (error !== null) await showMessage(error.title, error.message);
    return deleted;
  } catch (cause) {
    // The files went, but the library or the queue couldn't catch up; a rescan will.
    await showMessage(
      strings.songDeletion.couldntUpdateLibrary,
      cause instanceof Error ? cause.message : String(cause),
    );
    return [];
  }
};
