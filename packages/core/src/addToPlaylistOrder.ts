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

/**
 * An open card keeps the ranks it last showed, reading each row's current
 * details. New playlists go first in the usual add order; deleted ones leave.
 * Pass an empty [shown] when opening a new card to rank every playlist afresh.
 */
export const keepAddToPlaylistOrder = <P extends AddToPlaylistChoice>(
  playlists: readonly P[],
  shown: readonly { readonly id: number }[],
): P[] => {
  const byId = new Map(playlists.map((playlist) => [playlist.id, playlist]));
  const kept: P[] = [];
  for (const { id } of shown) {
    const playlist = byId.get(id);
    if (playlist === undefined) continue;
    kept.push(playlist);
    byId.delete(id);
  }
  return [...sortPlaylistsForAdd([...byId.values()]), ...kept];
};
