/**
 * A Library artist's page beyond its songs table, and the album hero's artist link, as the
 * window sees them (`window.wave.artistPage`): the album shelves, and the YouTube Music section
 * the page shows with YT Music on (docs/spec.md, "Artist page").
 */
import type { YtArtistAlbum, YtArtistSectionNote, YtPick } from "@wave/core";
import type { Invoke, Page } from "./bridge.ts";
import type { BrowseRow } from "./browse.ts";
import type { PlayStart } from "./playerView.ts";

/** An artist's Library albums: their own, and the ones they appear on. Album rows. */
export interface ArtistAlbums {
  readonly albums: readonly BrowseRow[];
  readonly appearsOn: readonly BrowseRow[];
}

/** One artist an album's credit names. */
export interface CreditedArtist {
  readonly id: number;
  readonly name: string;
}

/**
 * The artist page's YouTube Music section, or null when it has none (YT Music off, a name
 * that isn't an artist's): the Library | Online toggle, and with Online what YouTube Music
 * adds.
 */
export interface ArtistSectionView {
  /** The toggle's selected segment. */
  readonly toggle: YtPick;
  /** A quiet line in place of (or after) the songs, or null. */
  readonly note: YtArtistSectionNote | null;
  /** Whether YouTube Music should be asked now (`ytArtistSectionAsks`): call `ask`. */
  readonly asks: boolean;
  /**
   * Whether [songs] is the page's whole Popular list (Online, with the artist's list known):
   * the Library's files and the songs YouTube Music adds, in its order. The window then shows
   * it in place of the Library's songs table.
   */
  readonly popular: boolean;
  /** Under [popular], how many of the list's first songs carry a rank (1, 2, 3…). */
  readonly ranked: number;
  /** The Popular list; without it, the songs the Library doesn't have, in YouTube Music's order. */
  readonly songs: Page<BrowseRow>;
  /** Their releases the Library lacks: Albums, then Singles & EPs, each newest first. */
  readonly albums: readonly YtArtistAlbum[];
  readonly singles: readonly YtArtistAlbum[];
}

/** Where Play on the artist page starts: a Library row, or a song YouTube Music adds. */
export type ArtistPlayStart = { readonly library: number } | { readonly streamed: number } | null;

export interface ArtistPageContract {
  /** The artist's Library albums (`artistAlbums`). */
  readonly "artistPage.albums": {
    readonly args: readonly [artistId: number];
    readonly result: ArtistAlbums;
  };
  /** Who an album's album artist credit names, in credit order. */
  readonly "artistPage.albumArtists": {
    readonly args: readonly [albumId: number];
    readonly result: { readonly artists: readonly CreditedArtist[] };
  };
  /** The artist's YouTube Music section with [pick] picked (null: none yet); null: none. */
  readonly "artistPage.section": {
    readonly args: readonly [artistId: number, pick: YtPick | null, offset: number, limit: number];
    readonly result: ArtistSectionView | null;
  };
  /** Asks YouTube Music for the artist; resolves once answered, however it went. */
  readonly "artistPage.ask": { readonly args: readonly [artistId: number]; readonly result: void };
  /** Plays the page's songs from [start] (null: the first), shuffled or not. */
  readonly "artistPage.play": {
    readonly args: readonly [
      artistId: number,
      pick: YtPick | null,
      start: ArtistPlayStart,
      shuffle: boolean,
    ];
    readonly result: PlayStart;
  };
}

export const ARTIST_PAGE_CALLS = [
  "artistPage.albums",
  "artistPage.albumArtists",
  "artistPage.section",
  "artistPage.ask",
  "artistPage.play",
] as const;

export const artistPageBridge = (invoke: Invoke) => ({
  albums: (artistId: number) => invoke("artistPage.albums", artistId),
  albumArtists: (albumId: number) => invoke("artistPage.albumArtists", albumId),
  section: (artistId: number, pick: YtPick | null, offset: number, limit: number) =>
    invoke("artistPage.section", artistId, pick, offset, limit),
  ask: (artistId: number) => invoke("artistPage.ask", artistId),
  play: (artistId: number, pick: YtPick | null, start: ArtistPlayStart, shuffle: boolean) =>
    invoke("artistPage.play", artistId, pick, start, shuffle),
});
