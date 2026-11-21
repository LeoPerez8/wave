import type { Page } from "./bridge.ts";
import type { DiscHead, PlaylistSongSort, PlaylistSort, SongSort } from "@wave/core";

export const MAX_ROW_IDS_PAGE = 1000;

export const BROWSE_KINDS = [
  "songs",
  "albums",
  "artists",
  "playlists",
  "genres",
  "favorites",
  "album",
  "artist",
  "playlist",
  "genre",
  "search",
] as const;
export type BrowseKind = (typeof BROWSE_KINDS)[number];
export interface BrowseScope {
  readonly kind: BrowseKind;
  readonly id?: number;
  readonly query?: string;
  /**
   * What the page's Find field holds: the list shows, plays and selects only the rows it finds
   * (Core's `createFindMatcher`). Blank finds everything.
   */
  readonly find?: string;
}
export interface BrowseRow {
  readonly id: number;
  readonly title: string;
  readonly artist: string;
  readonly album: string;
  readonly artworkHash: string | null;
  readonly durationMs: number;
  readonly count: number;
  readonly year: number | null;
  readonly genre: string | null;
  readonly trackNumber: number | null;
  readonly favorite: boolean;
  readonly addedAt?: number;
  readonly starredAt?: number;
  /**
   * On a playlist's page, the song's place (from 1) in the playlist's own order; on an artist's,
   * its rank in their Popular list, when the list holds it.
   */
  readonly order?: number;
  /** On a playlist's page, the date its Release date sort reads: `1985`, `1985-06` or `1985-06-21`. */
  readonly released?: string;
  readonly path: string | null;
  readonly unavailable: boolean;
  /**
   * A YouTube Music song's video id. It has no Library row: its `id` is 0, or in a playlist its
   * entry's id negated.
   */
  readonly videoId?: string;
  /** A YouTube Music song's artists, each one, in order; [artist] joins them. */
  readonly artists?: readonly string[];
  /** A YouTube Music song's album page (its browse id), or null when YouTube Music names none. */
  readonly albumId?: string | null;
  /** A YouTube Music song's cover, fetched through `yt.artwork`. */
  readonly artworkUrl?: string | null;
  /** A playlist's own image, fetched through `playlists.image`; changes when the image does. */
  readonly imageKey?: string | null;
  /** A playlist several Wave accounts edit: the desktop shows and plays it, and edits none of it. */
  readonly collaborative?: boolean;
  /**
   * A file opened with Wave that the Library doesn't hold: its `id` is 0, its `path` the file,
   * and nothing of the Library's (a star, a playlist, counted plays) applies to it.
   */
  readonly outside?: true;
}
export interface BrowsePage extends Page<BrowseRow> {
  readonly hero?: BrowseRow;
  /** The order shown: the list's sort, or on a playlist's page that playlist's own. */
  readonly sort?: SongSort | PlaylistSongSort;
  /** On a page of an album with several discs, the "Disc n" heads over its whole list. */
  readonly discs?: readonly DiscHead[];
  /** On the Playlists list, its sort. */
  readonly listSort?: PlaylistSort;
}
