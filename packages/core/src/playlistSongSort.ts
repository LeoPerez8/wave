/**
 * The order a playlist's songs show in (docs/spec.md, "Playlist song sorting"): Custom, the
 * owner's own arrangement, or a sort by title, artist, album, date added or release date. A
 * sort only changes what shows; the arrangement stays stored as Custom.
 */

import { compareStrings, sortKey } from "./library.ts";
import type { ReleaseDate } from "./releaseDate.ts";
import { readSyncedBucket } from "./syncedBuckets.ts";

/** A playlist's song sort: Custom, or a key in a direction. */
export type PlaylistSongSort = {
  readonly key: "custom" | "title" | "artist" | "album" | "added" | "releaseDate";
  readonly descending: boolean;
};

/** The sort of a playlist that never picked one. */
export const CUSTOM_SONG_SORT: PlaylistSongSort = { key: "custom", descending: false };

const SORTED_KEYS = ["title", "artist", "album", "added", "releaseDate"] as const;

/**
 * How many synced preferences hold the playlists' sorts (Core's `syncedBucket`, by playlist
 * sync id). The Wave account keeps 5,000 playlists, and 32 values of 16,384 characters hold a
 * sort for each of them.
 */
export const PLAYLIST_SONG_SORT_BUCKETS = 32;

/** What a playlist's entry in its preference holds for [sort]: `title`, `-title`; null for Custom. */
export const storedPlaylistSongSort = (sort: PlaylistSongSort): string | null =>
  sort.key === "custom" ? null : `${sort.descending ? "-" : ""}${sort.key}`;

/** The sort a playlist's entry holds (`storedPlaylistSongSort`): Custom when it's unreadable. */
export const readPlaylistSongSort = (stored: unknown): PlaylistSongSort => {
  if (typeof stored !== "string") return CUSTOM_SONG_SORT;
  const descending = stored.startsWith("-");
  const key = SORTED_KEYS.find((sorted) => sorted === (descending ? stored.slice(1) : stored));
  return key === undefined ? CUSTOM_SONG_SORT : { key, descending };
};

/**
 * One preference's playlist sorts, by playlist sync id, as `storedPlaylistSongSort` keeps
 * them; an entry this Wave can't read is left out, so its playlist shows Custom.
 */
export const readPlaylistSongSorts = (stored: string | null): Record<string, string> =>
  readSyncedBucket(stored, (value) =>
    readPlaylistSongSort(value).key === "custom" ? null : (value as string),
  );

/** A playlist entry as its sorts read it. */
export interface PlaylistSortableSong {
  readonly releaseDate?: ReleaseDate | null | undefined;
  readonly year?: number | null;
  readonly discNumber?: number | null;
  readonly trackNumber?: number | null;
  readonly title: string;
  readonly artist: string;
  readonly album: string;
  readonly addedAt: number;
}

/** The date [song] sorts by under Release date: its release date, else its Year. */
const sortedDate = (song: PlaylistSortableSong): string | null =>
  song.releaseDate || (song.year ? String(song.year) : null);

/**
 * [entries] in [sort]'s order. Equal keys keep Custom order, and under Release date songs with
 * no date go last in either direction while equal dates go by disc and track. The entries
 * themselves never change.
 */
export const sortPlaylistSongs = <T extends PlaylistSortableSong>(
  entries: readonly T[],
  sort: PlaylistSongSort,
): T[] => {
  const { key } = sort;
  const direction = sort.descending ? -1 : 1;
  if (key === "custom") return [...entries];
  if (key === "releaseDate")
    return [...entries].sort((a, b) => {
      const left = sortedDate(a);
      const right = sortedDate(b);
      if (left === null || right === null) return left === right ? 0 : left === null ? 1 : -1;
      return (
        direction * compareStrings(left, right) ||
        (a.discNumber ?? 1) - (b.discNumber ?? 1) ||
        (a.trackNumber ?? Number.MAX_SAFE_INTEGER) - (b.trackNumber ?? Number.MAX_SAFE_INTEGER)
      );
    });
  return [...entries].sort(
    (a, b) =>
      direction *
      (key === "added" ? a.addedAt - b.addedAt : compareStrings(sortKey(a[key]), sortKey(b[key]))),
  );
};
