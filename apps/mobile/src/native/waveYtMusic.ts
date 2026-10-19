import type {
  DiscoverRadioSong,
  HostNetworkUse,
  YtArtistAlbum,
  YtArtistCandidate,
  YtArtistPage,
  YtPlaylist,
  YtPlaylistFirstPage,
  YtPlaylistPage,
  YtLibraryPlaylist,
  YtRadioStart,
  YtSession,
  YtSong,
} from "@wave/core";
import { NativeModule, requireNativeModule } from "expo";

import type { NativeArtwork } from "./waveNative";

/** A song YT Music found, as the native parser reads it. */
export interface NativeYtSong extends YtSong {
  /** The album's YT Music browse id (`MPREb_…`), for its tracklist and year. */
  readonly albumId: string | null;
}

/**
 * An artist page as the native parser reads it: top songs, albums, singles and
 * the playlist of every song of theirs (Core's `YtArtistPage`).
 */
export type NativeYtArtistPage = YtArtistPage<NativeYtSong>;

/**
 * A YT Music playlist's first page: its head, that page's songs and the token
 * for the next page (Core's `YtPlaylistFirstPage`). Songs YouTube Music greys
 * out (removed, blocked in the country) are left out.
 */
export type NativeYtPlaylistPage = YtPlaylistFirstPage<NativeYtSong>;

/** A later page of a YT Music playlist and the token for the next (Core's `YtPlaylistPage`). */
export type NativeYtPlaylistMore = YtPlaylistPage<NativeYtSong>;

/** A whole YT Music playlist as Core's `readYtPlaylist` reads it from those pages. */
export type NativeYtPlaylist = YtPlaylist<NativeYtSong>;

/** One page of song results; [continuation] asks for the next one. */
export interface NativeYtSearchPage {
  readonly songs: readonly NativeYtSong[];
  readonly continuation: string | null;
}

/** A song of YouTube Music's radio, which plays music videos too (Core's `DiscoverRadioSong`). */
export interface NativeYtRadioSong extends NativeYtSong, DiscoverRadioSong {}

/** A page of a radio, in the order it plays, and the token for the next. */
export interface NativeYtRadioPage {
  readonly songs: readonly NativeYtRadioSong[];
  readonly continuation: string | null;
}

/** An artist radio's first page, read from their page, and where it started (Core's `YtRadioStart`). */
export interface NativeYtArtistRadio extends NativeYtRadioPage {
  readonly start: YtRadioStart;
}

/**
 * The codes a YT Music request rejects with: no network, YouTube answered
 * with an error or something unreadable, YT Music is off in Settings, or a
 * request that needs the account's session (the library) has none YouTube
 * accepts.
 */
export type YtErrorCode =
  "ERR_YT_OFFLINE" | "ERR_YT_FAILED" | "ERR_YT_DISABLED" | "ERR_YT_SIGNED_OUT";

type WaveYtMusicEvents = {
  /** The session changed natively: YouTube ended it during a request, say. */
  onSessionChanged: (session: YtSession) => void;
};

/** An entry of a playlist the account made: the song's video id and the entry's own id. */
export interface NativeYtOwnEntry {
  readonly videoId: string;
  readonly setVideoId: string;
}

/** One change to a playlist the account made, applied in order (`editPlaylist`). */
export type NativeYtPlaylistEdit =
  | { readonly kind: "add"; readonly videoId: string }
  | { readonly kind: "remove"; readonly videoId: string; readonly setVideoId: string }
  /** Moves the entry right before the entry [before], or to the end for null. */
  | { readonly kind: "move"; readonly setVideoId: string; readonly before: string | null }
  | { readonly kind: "rename"; readonly title: string };

declare class WaveYtMusicModule extends NativeModule<WaveYtMusicEvents> {
  /**
   * Turns YT Music on or off. Off, every request rejects with
   * `ERR_YT_DISABLED` before reaching the network. Kept natively, so the
   * playback service knows too.
   */
  setEnabled(on: boolean): void;
  isEnabled(): boolean;
  /**
   * A new network meter's id: the reads given it (artist search, artist
   * page, radios) count their requests and bytes on the wire on it.
   */
  startNetworkMeter(): string;
  /** What the meter [id] counted, ending it (nothing for one already taken). */
  takeNetworkUse(id: string): HostNetworkUse;
  /**
   * Hands over the day's Wi-Fi pre-download list (Core's `mixPreDownload`;
   * empty for none): a native job fetches those songs into the audio cache
   * on an unmetered network with battery not low, without JS. Handing over
   * the same list again does nothing.
   */
  schedulePreDownload(videoIds: readonly string[]): Promise<void>;
  /** The video ids whose audio the audio cache holds whole: the songs that play offline. */
  cachedVideos(): Promise<readonly string[]>;
  /** Songs on YT Music for [query] (YouTube Music's "Songs" filter). */
  searchSongs(query: string): Promise<NativeYtSearchPage>;
  /** Artists on YT Music named like [query] (YouTube Music's "Artists" filter), in its order. */
  searchArtists(query: string, meter?: string): Promise<readonly YtArtistCandidate[]>;
  /** Albums, singles and EPs on YT Music for [query] (YouTube Music's "Albums" filter), in its order. */
  searchAlbums(query: string): Promise<readonly YtArtistAlbum[]>;
  /** The artist page [browseId] (`UC…`): their top songs, albums, singles and songs playlist. */
  artist(browseId: string, meter?: string): Promise<NativeYtArtistPage>;
  /** The playlist [playlistId] (without `VL`): its head and its first page of songs. */
  playlist(playlistId: string): Promise<NativeYtPlaylistPage>;
  /** The playlist page a first page's (or a later page's) [continuation] leads to. */
  playlistMore(continuation: string): Promise<NativeYtPlaylistMore>;
  /**
   * The playlists in the signed-in account's library (`FEmusic_liked_playlists`,
   * every page), in YouTube Music's order. Rejects with `ERR_YT_SIGNED_OUT`
   * signed out, or when YouTube no longer accepts the session (which then expires).
   */
  libraryPlaylists(): Promise<readonly YtLibraryPlaylist[]>;
  /**
   * The entries of the account's playlist [playlistId], every page; null
   * when it was deleted or isn't the account's. Rejects with
   * `ERR_YT_SIGNED_OUT` without a session YouTube accepts.
   */
  ownPlaylist(playlistId: string): Promise<readonly NativeYtOwnEntry[] | null>;
  /** Makes an unlisted playlist [title] on the account holding [videoIds] in order; resolves its id. */
  createPlaylist(title: string, videoIds: readonly string[]): Promise<string>;
  /** Applies [edits] to the account's playlist [playlistId], in order, in one request. */
  editPlaylist(playlistId: string, edits: readonly NativeYtPlaylistEdit[]): Promise<void>;
  /** The first page of the radio YouTube Music plays after the song [videoId] (it first). */
  songRadio(videoId: string, meter?: string): Promise<NativeYtRadioPage>;
  /**
   * The first page of the radio of the artist whose page is [browseId]
   * (`UC…`), read from the page, with where it started.
   */
  artistRadio(browseId: string, meter?: string): Promise<NativeYtArtistRadio>;
  /**
   * The first page of an artist's radio from where [artistRadio] found it
   * starts ([playlistId], [params]), without reading their page: rejects
   * with `ERR_YT_FAILED` when YouTube Music no longer starts one there.
   */
  startedRadio(
    playlistId: string,
    params: string | null,
    meter?: string,
  ): Promise<NativeYtRadioPage>;
  /** The radio page a radio page's [continuation] leads to. */
  radioMore(continuation: string, meter?: string): Promise<NativeYtRadioPage>;
  /**
   * Caches a YT Music song's cover from [url] beside the Library's artwork, so
   * the player, the notification and Auto show it as they do a Library
   * track's, and Now Playing takes its tint.
   */
  cacheArtwork(url: string): Promise<NativeArtwork>;
  /**
   * The saved session, without asking YouTube. Its credentials stay native;
   * JS only learns whose account it is.
   */
  session(): Promise<YtSession>;
  /** The session after asking YouTube whose it is; as it was when there's no answer. */
  checkSession(): Promise<YtSession>;
  /**
   * Opens Google's sign-in page over Wave. Resolves the signed-in session,
   * or null when the owner backs out; rejects with an `ERR_YT_*` code when
   * YouTube doesn't confirm the account.
   */
  signIn(): Promise<YtSession | null>;
  /** Forgets the session and clears the sign-in web view's cookies and storage. */
  signOut(): Promise<YtSession>;
}

/** YT Music through innertubex (`modules/wave-native`, package `yt`). */
export const WaveYtMusic = requireNativeModule<WaveYtMusicModule>("WaveYtMusic");

/** The reason a YT Music request failed, from its rejection. */
export const ytErrorCode = (error: unknown): YtErrorCode => {
  const code = (error as { code?: unknown } | null)?.code;
  return code === "ERR_YT_OFFLINE" || code === "ERR_YT_DISABLED" || code === "ERR_YT_SIGNED_OUT"
    ? code
    : "ERR_YT_FAILED";
};
