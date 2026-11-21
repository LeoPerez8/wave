/**
 * A Library artist's page beyond its songs table, and the album hero's artist link, as the
 * window sees them (`window.wave.artistPage`): the album shelves, and the YouTube Music section
 * the page shows with YT Music on (docs/spec.md, "Artist page").
 */
import type {
  DiscHead,
  YtArtistAlbum,
  YtArtistSectionNote,
  YtLibraryAlbumNote,
  YtPick,
} from "@wave/core";
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

/**
 * A Library album page's YouTube Music section, or null when it has none (YT Music off, an album
 * artist that isn't an artist's name): the Library | Online toggle, and with Online the album's
 * tracklist with the release's songs the Library lacks (docs/spec.md, "Album page").
 */
export interface AlbumSectionView {
  /** The toggle's selected segment. */
  readonly toggle: YtPick;
  /** A quiet line under the tracks, or null. */
  readonly note: YtLibraryAlbumNote | null;
  /** Whether YouTube Music should be asked now: call `albumAsk`. */
  readonly asks: boolean;
  /** What picking Online asks again after an ask got no answer; null: nothing. */
  readonly retry: "artist" | "release" | null;
  /**
   * With Online, the album's whole tracklist in the release's order: the Library's songs and the
   * release's songs streamed, each row's `trackNumber` its place on the release. Null shows the
   * album as it is.
   */
  readonly tracks: readonly BrowseRow[] | null;
  /** The "Disc n" heads over [tracks]. */
  readonly discs: readonly DiscHead[];
  /** The release's browse id once its songs are read: its Download acts on them. */
  readonly release: string | null;
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
  /** A Library album's YouTube Music section with [pick] picked (null: none yet); null: none. */
  readonly "artistPage.albumSection": {
    readonly args: readonly [albumId: number, pick: YtPick | null];
    readonly result: AlbumSectionView | null;
  };
  /**
   * Asks YouTube Music what the album's section waits for (its artist, or its release's page);
   * with [again], what an ask that got no answer asked. Resolves once answered, however it went.
   */
  readonly "artistPage.albumAsk": {
    readonly args: readonly [albumId: number, pick: YtPick | null, again: boolean];
    readonly result: void;
  };
  /** Plays the album's tracklist as the section shows it from row [start] (null: the first). */
  readonly "artistPage.albumPlay": {
    readonly args: readonly [
      albumId: number,
      pick: YtPick | null,
      start: number | null,
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
  "artistPage.albumSection",
  "artistPage.albumAsk",
  "artistPage.albumPlay",
] as const;

export const artistPageBridge = (invoke: Invoke) => ({
  albums: (artistId: number) => invoke("artistPage.albums", artistId),
  albumArtists: (albumId: number) => invoke("artistPage.albumArtists", albumId),
  section: (artistId: number, pick: YtPick | null, offset: number, limit: number) =>
    invoke("artistPage.section", artistId, pick, offset, limit),
  ask: (artistId: number) => invoke("artistPage.ask", artistId),
  play: (artistId: number, pick: YtPick | null, start: ArtistPlayStart, shuffle: boolean) =>
    invoke("artistPage.play", artistId, pick, start, shuffle),
  albumSection: (albumId: number, pick: YtPick | null) =>
    invoke("artistPage.albumSection", albumId, pick),
  albumAsk: (albumId: number, pick: YtPick | null, again: boolean) =>
    invoke("artistPage.albumAsk", albumId, pick, again),
  albumPlay: (albumId: number, pick: YtPick | null, start: number | null, shuffle: boolean) =>
    invoke("artistPage.albumPlay", albumId, pick, start, shuffle),
});
