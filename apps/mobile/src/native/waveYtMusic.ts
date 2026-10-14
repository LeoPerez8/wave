import type {
  YtArtistAlbum,
  YtArtistCandidate,
  YtArtistPage,
  YtSession,
  YtShelf,
  YtSong,
} from "@wave/core";
import { NativeModule, requireNativeModule } from "expo";

import type { NativeArtwork } from "./waveNative";

/** A song YT Music found, as the native parser reads it. */
export interface NativeYtSong extends YtSong {
  /** The album's YT Music browse id (`MPREb_…`), for its tracklist and year. */
  readonly albumId: string | null;
}

/** A home shelf as the native parser reads it (Core's `YtShelf`). */
export type NativeYtShelf = YtShelf<NativeYtSong>;

/** An artist page as the native parser reads it: top songs, albums and singles (Core's `YtArtistPage`). */
export type NativeYtArtistPage = YtArtistPage<NativeYtSong>;

/**
 * A YT Music playlist and all its songs in YouTube Music's order, read page
 * after page. Songs YouTube Music greys out (removed, blocked in the country)
 * are left out, and a song listed twice is kept once.
 */
export interface NativeYtPlaylist {
  readonly title: string;
  /** Who made it ("YouTube Music" for its own mixes), when the page says. */
  readonly author: string | null;
  readonly artworkUrl: string | null;
  readonly songs: readonly NativeYtSong[];
  /** The playlist goes on past [songs]: the read stopped at its cap of 5,000 songs. */
  readonly truncated: boolean;
}

/** One page of song results; [continuation] asks for the next one. */
export interface NativeYtSearchPage {
  readonly songs: readonly NativeYtSong[];
  readonly continuation: string | null;
}

/**
 * The codes a YT Music request rejects with: no network, YouTube answered
 * with an error or something unreadable, or YT Music is off in Settings.
 */
export type YtErrorCode = "ERR_YT_OFFLINE" | "ERR_YT_FAILED" | "ERR_YT_DISABLED";

type WaveYtMusicEvents = {
  /** The session changed natively: YouTube ended it during a request, say. */
  onSessionChanged: (session: YtSession) => void;
};

declare class WaveYtMusicModule extends NativeModule<WaveYtMusicEvents> {
  /**
   * Turns YT Music on or off. Off, every request rejects with
   * `ERR_YT_DISABLED` before reaching the network. Kept natively, so the
   * playback service knows too.
   */
  setEnabled(on: boolean): void;
  isEnabled(): boolean;
  /** Songs on YT Music for [query] (YouTube Music's "Songs" filter). */
  searchSongs(query: string): Promise<NativeYtSearchPage>;
  /** Artists on YT Music named like [query] (YouTube Music's "Artists" filter), in its order. */
  searchArtists(query: string): Promise<readonly YtArtistCandidate[]>;
  /** Albums, singles and EPs on YT Music for [query] (YouTube Music's "Albums" filter), in its order. */
  searchAlbums(query: string): Promise<readonly YtArtistAlbum[]>;
  /** The artist page [browseId] (`UC…`): their top songs, albums and singles. */
  artist(browseId: string): Promise<NativeYtArtistPage>;
  /** The session's account's recommendations: YouTube Music's home shelves (songs, albums, playlists). */
  home(): Promise<readonly NativeYtShelf[]>;
  /**
   * The playlist [playlistId] (without `VL`) and all its songs, up to 5,000.
   * Rejects with an `ERR_YT_*` code when any page fails, never with part of it.
   */
  playlist(playlistId: string): Promise<NativeYtPlaylist>;
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
  return code === "ERR_YT_OFFLINE" || code === "ERR_YT_DISABLED" ? code : "ERR_YT_FAILED";
};
