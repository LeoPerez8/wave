import { canFixSong, type ActionItem, type SongListRowSource, type SongRowState } from "@wave/core";
import type { SongRow, SongSummary } from "@/library/LibraryStore";

export interface SongListEntry {
  readonly source: SongListRowSource;
  readonly state?: SongRowState;
  /** Metadata already read by the screen; menu construction waits for an action. */
  readonly facts?: ActionItem;
}

export const librarySongEntry = (song: SongRow, state?: SongRowState): SongListEntry => ({
  source: { kind: "library", song },
  state,
  facts: {
    missing: song.path === null,
    albumId: song.albumId,
    artistIds: song.artistIds,
    fixable: canFixSong(song),
  },
});

export const summarySongEntry = (id: number, song: SongSummary | undefined): SongListEntry =>
  song === undefined
    ? {
        source: { kind: "loading", key: String(id) },
      }
    : {
        source: { kind: "librarySummary", song },
        state: { leading: { kind: "playDisc" }, kindLine: true },
        facts: {
          missing: !song.hasFile,
          albumId: song.albumId,
          artistIds: [song.artistId],
          fixable: song.fixable,
        },
      };
