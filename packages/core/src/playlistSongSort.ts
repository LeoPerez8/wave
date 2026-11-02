import { compareStrings, sortKey } from "./library.ts";
import { readStoredRecord } from "./storedJson.ts";
export type PlaylistSongSort = {
  readonly key: "custom" | "title" | "artist" | "album" | "added" | "releaseDate";
  readonly descending: boolean;
};
export const readPlaylistSongSort = (stored: string | null): PlaylistSongSort => {
  const value = readStoredRecord(stored);
  const key = value.key;
  return key === "releaseDate" ||
    key === "title" ||
    key === "artist" ||
    key === "album" ||
    key === "added"
    ? { key, descending: value.descending === true }
    : { key: "custom", descending: false };
};
export interface PlaylistSortableSong {
  readonly releaseDate?: string | null | undefined;
  readonly year?: number | null;
  readonly discNumber?: number | null;
  readonly trackNumber?: number | null;
  readonly title: string;
  readonly artist: string;
  readonly album: string;
  readonly addedAt: number;
}
/** Stable ties preserve Custom; sorting never changes the stored entries. */
export const sortPlaylistSongs = <T extends PlaylistSortableSong>(
  entries: readonly T[],
  sort: PlaylistSongSort,
): T[] => {
  const key = sort.key;
  if (key === "custom") return [...entries];
  if (key === "releaseDate")
    return [...entries].sort((a, b) => {
      const date = (song: PlaylistSortableSong) =>
        song.releaseDate || (song.year ? String(song.year) : null);
      const left = date(a),
        right = date(b);
      if (left === null || right === null) return left === right ? 0 : left === null ? 1 : -1;
      return (
        (sort.descending ? -1 : 1) * compareStrings(left, right) ||
        (a.discNumber ?? 0) - (b.discNumber ?? 0) ||
        (a.trackNumber ?? 0) - (b.trackNumber ?? 0)
      );
    });
  return [...entries].sort(
    (a, b) =>
      (sort.descending ? -1 : 1) *
      (key === "added" ? a.addedAt - b.addedAt : compareStrings(sortKey(a[key]), sortKey(b[key]))),
  );
};
