/**
 * A playlist's Graveyard (spec, Playlists › Graveyard): which removed songs it shows, which
 * removals forgetting one forgets, and where Restore puts a removed song back.
 */

import { playlistSongKey, type PlaylistItem } from "./playlistEntries.ts";
import { libraryFinder, type LibrarySongKey, type YtSong } from "./ytMusic.ts";

/** A playlist entry as the Graveyard tells songs apart: a Library song by its Track. */
export type GraveyardItem = PlaylistItem<YtSong, LibrarySongKey & { readonly id: number }>;

/**
 * What tells [items]' songs apart: a Library song is its Track, and so is another song that
 * Track is (`libraryFinder`, among [items]' Library songs); any other is itself
 * (`playlistSongKey`).
 */
const songKeys = (items: readonly GraveyardItem[]): ((item: GraveyardItem) => string) => {
  const find = libraryFinder(
    items.flatMap((item) => (item.source === "library" ? [item.track] : [])),
  );
  return (item) => {
    if (item.source === "library") return String(item.track.id);
    const match = find(item.song);
    return match === null ? playlistSongKey(item) : String(match.id);
  };
};

/**
 * The songs the Graveyard shows, of the playlist's [removed] entries (newest removal first):
 * each song's newest removal, unless the playlist [held] holds the song again.
 */
export const graveyardSongs = <H extends GraveyardItem, R extends GraveyardItem>(
  held: readonly H[],
  removed: readonly R[],
): R[] => {
  const key = songKeys([...held, ...removed]);
  const seen = new Set(held.map(key));
  return removed.filter((item) => {
    const song = key(item);
    if (seen.has(song)) return false;
    seen.add(song);
    return true;
  });
};

/** The removals among [removed] that forgetting [target]'s song forgets: every one of that song. */
export const graveyardRemovalsOf = <R extends GraveyardItem>(
  removed: readonly R[],
  target: GraveyardItem,
): R[] => {
  const key = songKeys([target, ...removed]);
  const song = key(target);
  return removed.filter((item) => key(item) === song);
};

/** A playlist row as Restore weighs it, in playlist order, its removed rows among the others. */
export interface GraveyardSlot {
  readonly itemId: number;
  readonly addedAt: number;
  /** When it left the playlist; null while it's in it. */
  readonly goneAt: number | null;
}

/**
 * Where Restore puts the song of [itemId], removed at [removedAt]: its index among the
 * playlist's [rows] still in it, the old place, while either song beside it when it was
 * removed (songs added later and removed earlier aside) is still in the playlist, whatever
 * changed in them since; null, the end, once both have left.
 */
export const graveyardRestoreIndex = (
  rows: readonly GraveyardSlot[],
  itemId: number,
  removedAt: number,
): number | null => {
  const at = rows.findIndex((row) => row.itemId === itemId);
  if (at < 0) return null;
  const wasThere = (row: GraveyardSlot) =>
    row.addedAt <= removedAt && (row.goneAt === null || row.goneAt >= removedAt);
  const before = rows.slice(0, at).findLast(wasThere);
  const after = rows.slice(at + 1).find(wasThere);
  if (before?.goneAt !== null && after?.goneAt !== null) return null;
  return rows.slice(0, at).filter((row) => row.goneAt === null).length;
};
