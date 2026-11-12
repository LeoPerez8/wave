import { parseTrackId } from "@wave/core";
import type { QueueTrack } from "./queueTracks.ts";

/**
 * How long the queue's songs are, for the time left to play in it (Core's
 * `queueContinuation`). A streamed song's length comes with its queue track;
 * a Library song's is read from the Library once and kept here.
 */
export const makeQueueLengths = () => {
  /** By Library id; null for one asked for that the Library doesn't have. */
  const library = new Map<number, number | null>();
  const libraryId = (trackId: string): number | null => {
    const ref = parseTrackId(trackId);
    return ref?.kind === "library" ? ref.id : null;
  };
  return {
    /** The length of [trackId], null while it isn't known. */
    of: (trackId: string, tracks: ReadonlyMap<string, QueueTrack>): number | null => {
      const id = libraryId(trackId);
      return id === null
        ? (tracks.get(trackId)?.ytSong?.durationMs ?? null)
        : (library.get(id) ?? null);
    },
    /** The Library songs among [trackIds] whose length was never read. */
    missing: (trackIds: readonly string[]): number[] => [
      ...new Set(
        trackIds.flatMap((trackId) => {
          const id = libraryId(trackId);
          return id === null || library.has(id) ? [] : [id];
        }),
      ),
    ],
    /** Keeps what the Library answered for [asked]: the lengths of [songs], the rest unknown. */
    learn: (
      asked: readonly number[],
      songs: readonly { readonly id: number; readonly durationMs: number | null }[],
    ): void => {
      for (const id of asked) library.set(id, null);
      for (const song of songs)
        library.set(
          song.id,
          song.durationMs !== null && song.durationMs > 0 ? song.durationMs : null,
        );
    },
  };
};
