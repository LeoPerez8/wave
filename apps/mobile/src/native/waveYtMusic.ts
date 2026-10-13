import type { YtSession, YtSong } from "@wave/core";
import { NativeModule, requireNativeModule } from "expo";

/** A song YT Music found, as the native parser reads it. */
export interface NativeYtSong extends YtSong {
  /** The album's YT Music browse id (`MPREb_…`), for its tracklist and year. */
  readonly albumId: string | null;
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
