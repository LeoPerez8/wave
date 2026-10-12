import { confirmSongDeletion, songDeletionFailure, type SongDeleteFailureReason } from "@wave/core";
import * as Effect from "effect/Effect";

import { WaveNative, type FileDeleteOutcome } from "@/native/waveNative";
import { confirmAction, showMessage } from "@/overlay/alert";
import { Queue } from "@/playback/Queue";

import { forgetFavorites } from "./favorites";
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

const deleteFiles = (paths: readonly string[]) =>
  Effect.tryPromise(() => WaveNative.deleteFiles(paths)).pipe(
    // The native call failing as a whole leaves every file where it was.
    Effect.orElseSucceed((): readonly FileDeleteOutcome[] => paths.map(() => "failed")),
  );

/**
 * Deletes the songs' audio files (and sidecar `.lrc` files) from the phone,
 * without asking. The songs whose files are gone leave the library, every
 * playlist, Favorites and the queue (the playing one moves on to the next);
 * their play history stays. Songs whose files couldn't be deleted stay as they were.
 */
export const deleteSongs = <S extends DeletableSong>(
  songs: readonly S[],
): Promise<SongsDeleted<S>> =>
  appRuntime.runPromise(
    Effect.gen(function* () {
      const outcomes = yield* deleteFiles(songs.map((song) => song.path));
      const deleted: S[] = [];
      const failed: { song: S; reason: SongDeleteFailureReason }[] = [];
      songs.forEach((song, i) => {
        const outcome = outcomes[i] ?? "failed";
        if (outcome === "deleted") deleted.push(song);
        else failed.push({ song, reason: outcome });
      });
      if (deleted.length === 0) return { deleted, failed };

      const store = yield* LibraryStore;
      const queue = yield* Queue;
      // Playlist items and stars go with the tracks (foreign keys); history doesn't.
      yield* store
        .removeTracks(deleted.map((song) => song.path))
        .pipe(Effect.ensuring(Effect.sync(libraryEdited)));
      forgetFavorites(deleted.map((song) => song.id));
      yield* queue.dispatch({
        type: "removeTracks",
        trackIds: deleted.map((song) => String(song.id)),
      });
      return { deleted, failed };
    }),
  );

/**
 * Asks first ("Delete "Song"?"), then deletes the songs (`deleteSongs`) and
 * says which couldn't be deleted. Resolves with the songs deleted: none when
 * cancelled.
 */
export const confirmDeleteSongs = async <S extends DeletableSong>(
  songs: readonly S[],
): Promise<readonly S[]> => {
  if (songs.length === 0) return [];
  if (!(await confirmAction(confirmSongDeletion(songs)))) return [];
  try {
    const { deleted, failed } = await deleteSongs(songs);
    const error = songDeletionFailure(
      failed.map(({ song, reason }) => ({ title: song.title, reason })),
      songs.length,
    );
    if (error !== null) await showMessage(error.title, error.message);
    return deleted;
  } catch (cause) {
    // The files went, but the library or the queue couldn't catch up; a rescan will.
    await showMessage(
      "Couldn't update the library",
      cause instanceof Error ? cause.message : String(cause),
    );
    return [];
  }
};
