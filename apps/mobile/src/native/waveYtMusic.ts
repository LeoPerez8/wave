import type { YtSession, YtShelf, YtSong } from "@wave/core";
import { NativeModule, requireNativeModule } from "expo";

import type { NativeArtwork } from "./waveNative";

/** A song YT Music found, as the native parser reads it. */
export interface NativeYtSong extends YtSong {
  /** The album's YT Music browse id (`MPREb_…`), for its tracklist and year. */
  readonly albumId: string | null;
}

/** A home shelf as the native parser reads it (Core's `YtShelf`). */
export type NativeYtShelf = YtShelf<NativeYtSong>;

/** A YT Music playlist page and its first page of songs. */
export interface NativeYtPlaylist {
  readonly title: string;
  /** Who made it ("YouTube Music" for its own mixes), when the page says. */
  readonly author: string | null;
  readonly artworkUrl: string | null;
  readonly songs: readonly NativeYtSong[];
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
  /** The session's account's recommendations: YouTube Music's home shelves (songs, albums, playlists). */
  home(): Promise<readonly NativeYtShelf[]>;
  /** The playlist [playlistId] (without `VL`) and its first page of songs. */
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
