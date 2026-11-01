import { compareStrings } from "./library.ts";
import type { SortablePlaylist } from "./playlistSort.ts";

/** A playlist's newest remaining entry, or null when it holds no entries. */
export interface AddToPlaylistChoice extends SortablePlaylist {
  readonly lastEntryAddedAt: number | null;
}

/** Add to Playlist's order: latest addition first, empty playlists by creation, ties by name. */
export const sortPlaylistsForAdd = <P extends AddToPlaylistChoice>(
  playlists: readonly P[],
): P[] => {
  const date = (playlist: P): number => playlist.lastEntryAddedAt ?? playlist.createdAt;
  // oxlint-disable-next-line unicorn/no-array-sort -- sorts a fresh array; Hermes lacks toSorted
  return [...playlists].sort(
    (a, b) => date(b) - date(a) || compareStrings(a.sort, b.sort) || a.id - b.id,
  );
};
