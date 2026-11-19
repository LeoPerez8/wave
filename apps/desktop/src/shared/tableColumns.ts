import type { BrowseKind } from "./browse.ts";

/**
 * The columns a Library table shows for its scope (docs/spec-desktop.md, Window and layout), so
 * no header sits over a column that is always empty. Title and time are always there.
 */
export interface TableColumns {
  /** What leads the title: the thumbnail, or the track number on an album's own page. */
  readonly picture: "artwork" | "trackNumber";
  /** A song's artist, or a group's song count. */
  readonly second: "artist" | "songs";
  /** A song's album or an album's artist; null when the scope has nothing to put there. */
  readonly third: "album" | "artist" | null;
  /** The favourite star: songs only. */
  readonly star: boolean;
}

export const tableColumns = (kind: BrowseKind): TableColumns => {
  switch (kind) {
    case "album":
      return { picture: "trackNumber", second: "artist", third: null, star: true };
    case "albums":
      return { picture: "artwork", second: "songs", third: "artist", star: false };
    case "artists":
    case "genres":
    case "playlists":
      return { picture: "artwork", second: "songs", third: null, star: false };
    default:
      return { picture: "artwork", second: "artist", third: "album", star: true };
  }
};
