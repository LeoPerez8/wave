import type { Page } from "./bridge.ts";

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
  readonly path: string | null;
  readonly unavailable: boolean;
  /**
   * A YouTube Music song's video id. It has no Library row: its `id` is 0, or in a playlist its
   * entry's id negated.
   */
  readonly videoId?: string;
  /** A YouTube Music song's cover, fetched through `yt.artwork`. */
  readonly artworkUrl?: string | null;
  /** A playlist's own image, fetched through `playlists.image`; changes when the image does. */
  readonly imageKey?: string | null;
}
export interface BrowsePage extends Page<BrowseRow> {
  readonly hero?: BrowseRow;
}
