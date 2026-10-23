/** SQLite's orders restored in JS, so reads that walk pages by id sort their copy in yielding steps. */
import type { SongRow } from "./LibraryStore.ts";

/** SQLite BINARY: Unicode code points (not UTF-16 or locale order). */
export const binary = (a: string, b: string): number => {
  for (let i = 0, j = 0; i < a.length || j < b.length;) {
    if (i === a.length) return -1;
    if (j === b.length) return 1;
    const left = a.codePointAt(i)!,
      right = b.codePointAt(j)!;
    if (left !== right) return left - right;
    i += left > 0xffff ? 2 : 1;
    j += right > 0xffff ? 2 : 1;
  }
  return 0;
};

/** ti's song order: title, artist, then path, NULL before text, each compared as BINARY. */
export const byTitleArtistPath = (
  a: Pick<SongRow, "titleSort" | "artistSort" | "path">,
  b: Pick<SongRow, "titleSort" | "artistSort" | "path">,
): number =>
  binary(a.titleSort, b.titleSort) ||
  binary(a.artistSort, b.artistSort) ||
  (a.path === null ? (b.path === null ? 0 : -1) : b.path === null ? 1 : binary(a.path, b.path));
