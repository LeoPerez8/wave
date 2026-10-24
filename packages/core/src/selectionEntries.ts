import { groupSongs } from "./groupSongs.ts";
import { queueSongTrackId, type QueueSong } from "./playlistEntries.ts";
import type { YtSong } from "./ytMusic.ts";

/** A Library track as matching sees it: one with a file plays as the Library's. */
export interface MatchedTrack {
  readonly id: number;
  readonly path: string | null;
}

/**
 * What a selection bar action acts on when its checked items are read only
 * once it runs (an artist page's streamed releases checked with songs): each
 * item's songs ([entries]), in page order, a song two items hold once
 * (`groupSongs`). The Library finder is asked after every item is read, and
 * only when some song streams; a streamed song the Library has a file of by
 * now acts as the Library's. An item that can't be read fails the whole
 * action, so it never acts on part of the selection.
 */
export const selectionEntries = async <I, S extends YtSong, L extends MatchedTrack>(
  items: readonly I[],
  read: {
    readonly entries: (item: I) => Promise<readonly QueueSong<S, L>[]>;
    readonly finder: () => Promise<(song: S) => L | null>;
  },
): Promise<QueueSong<S, L>[]> => {
  const lists = await Promise.all(items.map(read.entries));
  const streams = lists.some((list) => list.some((entry) => entry.source === "stream"));
  const find = streams ? await read.finder() : () => null;
  const matched = lists.map((list) =>
    list.map((entry): QueueSong<S, L> => {
      if (entry.source !== "stream") return entry;
      const track = find(entry.song);
      return track === null || track.path === null ? entry : { source: "library", track };
    }),
  );
  return groupSongs(matched, queueSongTrackId);
};
