/**
 * Discover (docs/spec.md, "YT Music"): the signed-in YouTube Music account's
 * recommendations, the shelves YouTube Music's home offers. The native module
 * asks for and reads the shelves; Core decides what the screen shows, what
 * tapping a shelf's item does, and which songs play from the Library's file
 * rather than streamed.
 */

import type { YtAlbum, YtAlbumTrack } from "./ytDownload.ts";
import type { YtQuietReason } from "./ytSearch.ts";
import { joinArtists, ytTrackId, type YtSong } from "./ytMusic.ts";

/** Something on a shelf of YouTube Music's home that Wave can open or play. */
export type YtShelfItem<S extends YtSong = YtSong> =
  | { readonly kind: "song"; readonly song: S }
  | {
      readonly kind: "album";
      /** The album's page (`MPREb_…`). */
      readonly browseId: string;
      readonly title: string;
      readonly artists: readonly string[];
      readonly year: number | null;
      readonly artworkUrl: string | null;
    }
  | {
      readonly kind: "playlist";
      /** The playlist's id, without the `VL` its page adds. */
      readonly playlistId: string;
      readonly title: string;
      /** Its line under the title, as YouTube Music writes it ("Owner • 1.2M views"). */
      readonly credit: string | null;
      readonly artworkUrl: string | null;
    };

/** One of YouTube Music's home shelves ("Quick picks", "Mixed for you"…). */
export interface YtShelf<S extends YtSong = YtSong> {
  readonly title: string;
  readonly items: readonly YtShelfItem<S>[];
}

/** YouTube Music's home, as far as Wave reads it. */
export interface YtHome<S extends YtSong = YtSong> {
  readonly shelves: readonly YtShelf<S>[];
}

/** The recommendations as last asked for: the answer, and whether a newer question is out. */
export interface DiscoverState<S extends YtSong = YtSong> {
  /** Counts the questions, so an answer to an older one is dropped. */
  readonly request: number;
  readonly loading: boolean;
  /** The last home YouTube Music answered with; kept up while it's asked again. */
  readonly home: YtHome<S> | null;
  /** Why the last question got no answer, until the next one is asked. */
  readonly failure: YtQuietReason | null;
}

export const DISCOVER_START: DiscoverState<never> = {
  request: 0,
  loading: false,
  home: null,
  failure: null,
};

export type DiscoverEvent<S extends YtSong = YtSong> =
  /** Discover asks YouTube Music for the home: on opening, or pulled to refresh. */
  | { readonly type: "requested" }
  | { readonly type: "loaded"; readonly request: number; readonly home: YtHome<S> }
  | { readonly type: "failed"; readonly request: number; readonly reason: YtQuietReason }
  /** The account signed out or its session ended: its recommendations go with it. */
  | { readonly type: "signedOut" };

export const stepDiscover = <S extends YtSong>(
  state: DiscoverState<S>,
  event: DiscoverEvent<S>,
): DiscoverState<S> => {
  switch (event.type) {
    case "requested":
      return { ...state, request: state.request + 1, loading: true, failure: null };
    case "loaded":
      if (event.request !== state.request) return state;
      return { ...state, loading: false, home: event.home, failure: null };
    case "failed":
      if (event.request !== state.request) return state;
      return { ...state, loading: false, failure: event.reason };
    case "signedOut":
      return { request: state.request + 1, loading: false, home: null, failure: null };
  }
};

/**
 * A YT Music song as Discover plays it: the Library's file when the Library
 * already has the song (Core's `libraryFinder`), else streamed.
 */
export type DiscoverSong<S extends YtSong = YtSong, L = unknown> =
  | { readonly source: "stream"; readonly song: S }
  | { readonly source: "library"; readonly song: S; readonly track: L };

/** Something on a Discover shelf: a song (from the Library or streamed), an album or a playlist. */
export type DiscoverItem<S extends YtSong = YtSong, L = unknown> =
  | { readonly kind: "song"; readonly song: DiscoverSong<S, L> }
  | Exclude<YtShelfItem<S>, { readonly kind: "song" }>;

/** A shelf as Discover lays it out. */
export interface DiscoverShelf<S extends YtSong = YtSong, L = unknown> {
  readonly title: string;
  /** Only songs: song rows. Anything else: a row of covers. */
  readonly layout: "songs" | "tiles";
  readonly items: readonly DiscoverItem<S, L>[];
}

export type DiscoverView<S extends YtSong = YtSong, L = unknown> =
  /** YT Music is off in Settings. */
  | { readonly kind: "off" }
  /** Recommendations come from the account: Discover points to Sign In. */
  | { readonly kind: "signedOut" }
  | { readonly kind: "loading" }
  | { readonly kind: "offline" }
  | { readonly kind: "failed" }
  /** YouTube Music answered with nothing Wave can show. */
  | { readonly kind: "empty" }
  | { readonly kind: "shelves"; readonly shelves: readonly DiscoverShelf<S, L>[] };

export interface DiscoverContext<S extends YtSong, L = unknown> {
  /** Whether YT Music is on in Settings. */
  readonly enabled: boolean;
  /** Whether a YouTube account is signed in (an expired session isn't); null until known. */
  readonly signedIn: boolean | null;
  /** The Library song a YT Music song already is, or null (Core's `libraryFinder`). */
  readonly find: (song: S) => L | null;
}

const discoverSong = <S extends YtSong, L>(
  song: S,
  find: (song: S) => L | null,
): DiscoverSong<S, L> => {
  const track = find(song);
  return track === null ? { source: "stream", song } : { source: "library", song, track };
};

/** [songs] as Discover plays them: each from the Library's file when it has the song. */
export const discoverSongs = <S extends YtSong, L>(
  songs: readonly S[],
  find: (song: S) => L | null,
): DiscoverSong<S, L>[] => songs.map((song) => discoverSong(song, find));

const discoverShelf = <S extends YtSong, L>(
  shelf: YtShelf<S>,
  find: (song: S) => L | null,
): DiscoverShelf<S, L> => {
  const items = shelf.items.map((item): DiscoverItem<S, L> =>
    item.kind === "song" ? { kind: "song", song: discoverSong(item.song, find) } : item,
  );
  const layout = items.every((item) => item.kind === "song") ? "songs" : "tiles";
  return { title: shelf.title, layout, items };
};

/**
 * Whether Discover should ask YouTube Music for the home now: signed in with
 * YT Music on, nothing asked yet (or forgotten on sign-out). After an answer
 * or a failure it's asked again only when pulled to refresh.
 */
export const discoverShouldAsk = <S extends YtSong, L>(
  state: DiscoverState<S>,
  context: DiscoverContext<S, L>,
): boolean =>
  context.enabled &&
  context.signedIn === true &&
  !state.loading &&
  state.home === null &&
  state.failure === null;

/** What the Discover screen shows. */
export const discoverView = <S extends YtSong, L>(
  state: DiscoverState<S>,
  context: DiscoverContext<S, L>,
): DiscoverView<S, L> => {
  if (!context.enabled) return { kind: "off" };
  if (context.signedIn === null) return { kind: "loading" };
  if (!context.signedIn) return { kind: "signedOut" };
  if (state.home !== null) {
    const shelves = state.home.shelves
      .filter((shelf) => shelf.items.length > 0)
      .map((shelf) => discoverShelf(shelf, context.find));
    return shelves.length === 0 ? { kind: "empty" } : { kind: "shelves", shelves };
  }
  if (state.failure !== null) return { kind: state.failure };
  return { kind: "loading" };
};

/** What tapping a Discover item does. */
export type DiscoverAction<S extends YtSong = YtSong, L = unknown> =
  /** Plays [songs] from [startIndex], queueing the rest after it. */
  | {
      readonly type: "play";
      readonly songs: readonly DiscoverSong<S, L>[];
      readonly startIndex: number;
    }
  | { readonly type: "openAlbum"; readonly browseId: string; readonly title: string }
  | { readonly type: "openPlaylist"; readonly playlistId: string; readonly title: string };

/**
 * What tapping [shelf]'s item at [index] does: a song plays the shelf's songs
 * from it (its albums and playlists left out); an album or a playlist opens
 * its songs. Null when there's no such item.
 */
export const discoverItemAction = <S extends YtSong, L>(
  shelf: DiscoverShelf<S, L>,
  index: number,
): DiscoverAction<S, L> | null => {
  const item = shelf.items[index];
  switch (item?.kind) {
    case undefined:
      return null;
    case "song": {
      const songs = shelf.items.flatMap((other) => (other.kind === "song" ? [other.song] : []));
      return { type: "play", songs, startIndex: songs.indexOf(item.song) };
    }
    case "album":
      return { type: "openAlbum", browseId: item.browseId, title: item.title };
    case "playlist":
      return { type: "openPlaylist", playlistId: item.playlistId, title: item.title };
  }
};

/** The caption under a Discover cover: a catalog line, then a detail line. */
export interface DiscoverTileCaption {
  /** Who made it: the artists, or the playlist's maker; empty when unknown. */
  readonly line: string;
  /** What it is: "Album · 2024", "Playlist", "Song". */
  readonly detail: string;
}

/** What a Discover cover's caption says about [item]. */
export const discoverTileCaption = <S extends YtSong>(
  item: YtShelfItem<S> | DiscoverItem<S>,
): DiscoverTileCaption => {
  switch (item.kind) {
    case "song":
      return {
        line: joinArtists("source" in item.song ? item.song.song.artists : item.song.artists),
        detail: "Song",
      };
    case "album":
      return {
        line: joinArtists(item.artists),
        detail: item.year === null ? "Album" : `Album · ${item.year}`,
      };
    case "playlist":
      // "Owner • 15M views": the owner, without YouTube's count.
      return { line: item.credit?.split(" • ")[0]?.trim() ?? "", detail: "Playlist" };
  }
};

/** A song on a YT Music album page, as its tracklist lists it. */
export interface YtAlbumPageTrack extends YtAlbumTrack {
  readonly artists: readonly string[];
  readonly durationMs: number | null;
  readonly explicit: boolean;
}

/** A YT Music song that knows its album's page. */
export interface YtAlbumSong extends YtSong {
  readonly albumId: string | null;
}

/**
 * The songs of the album page [browseId]: its tracks, on that album, with its
 * cover (the tracklist doesn't give each its own).
 */
export const ytAlbumSongs = (
  browseId: string,
  album: Omit<YtAlbum, "tracks"> & { readonly tracks: readonly YtAlbumPageTrack[] },
): YtAlbumSong[] =>
  album.tracks.map((track) => ({
    videoId: track.videoId,
    title: track.title,
    artists: track.artists,
    album: album.title,
    albumId: browseId,
    durationMs: track.durationMs,
    artworkUrl: album.artworkUrl,
    explicit: track.explicit,
  }));

/** The id [song] goes by in the queue: its Library track's, or its YT Music id. */
export const discoverTrackId = <S extends YtSong>(
  song: DiscoverSong<S, { readonly id: number }>,
): string => (song.source === "library" ? String(song.track.id) : ytTrackId(song.song.videoId));
