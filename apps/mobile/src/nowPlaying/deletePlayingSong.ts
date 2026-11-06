import { streamedAfterDelete, type LeavingSong, type YtSong } from "@wave/core";

/** What deleting the playing song needs to know about it (any `SongRow` with a file will do). */
export interface DeletablePlayingSong {
  readonly id: number;
  readonly path: string;
  readonly title: string;
}

export interface DeletePlayingSongPorts<T extends DeletablePlayingSong> {
  /** The song as it leaves the Library (`LibraryStore.leavingSong`); null when that can't be read. */
  readonly leaving: (track: T) => Promise<LeavingSong | null>;
  readonly ytMusicOn: () => boolean;
  /**
   * The song menu's Delete, its confirmation first (`confirmDeleteSongs`):
   * [filesGone] runs with the songs whose files are gone, and is awaited,
   * before they leave the Library and the queue. It doesn't run when the
   * delete is cancelled or no file could be deleted.
   */
  readonly confirmDelete: (
    songs: readonly T[],
    options: { readonly filesGone: (deleted: readonly T[]) => Promise<void> },
  ) => Promise<unknown>;
  /** The playing song [trackId] goes on as [song] (`streamPlayingInstead`). */
  readonly streamInstead: (trackId: string, song: YtSong) => Promise<void>;
}

/**
 * Download on a song with a file: the song menu's Delete, its confirmation
 * first. Once its file is gone, the song playing from it goes on streamed
 * from where it was when it came from YouTube Music and YouTube Music is on
 * (Core's `streamedAfterDelete`), before the delete takes its entries out of
 * the queue; otherwise the delete moves the queue on to the next song, as
 * the menu's Delete does. A file that couldn't be deleted keeps playing.
 */
export const createDeletePlayingSong =
  <T extends DeletablePlayingSong>(ports: DeletePlayingSongPorts<T>) =>
  async (target: { readonly trackId: string }, track: T): Promise<void> => {
    // Read before asking, so the files going isn't kept waiting on it.
    const leaving = await ports.leaving(track);
    await ports.confirmDelete([track], {
      filesGone: async (deleted) => {
        if (leaving === null || !deleted.some((song) => song.id === track.id)) return;
        const song = streamedAfterDelete(
          target.trackId,
          { ...leaving, id: track.id },
          { ytMusicOn: ports.ytMusicOn() },
        );
        if (song !== null) await ports.streamInstead(target.trackId, song);
      },
    });
  };
