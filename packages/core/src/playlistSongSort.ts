import { compareStrings, sortKey } from "./library.ts";
import { readStoredRecord } from "./storedJson.ts";
export type PlaylistSongSort = {
  readonly key: "custom" | "title" | "artist" | "album" | "added";
  readonly descending: boolean;
};
export const readPlaylistSongSort = (stored: string | null): PlaylistSongSort => {
  const value = readStoredRecord(stored);
  const key = value.key;
  return key === "title" || key === "artist" || key === "album" || key === "added"
    ? { key, descending: value.descending === true }
    : { key: "custom", descending: false };
};
export interface PlaylistSortableSong {
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
  return [...entries].sort(
    (a, b) =>
      (sort.descending ? -1 : 1) *
      (key === "added" ? a.addedAt - b.addedAt : compareStrings(sortKey(a[key]), sortKey(b[key]))),
  );
};
