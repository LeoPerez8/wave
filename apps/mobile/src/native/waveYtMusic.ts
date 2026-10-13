import type { YtSong } from "@wave/core";
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

declare class WaveYtMusicModule extends NativeModule<Record<never, never>> {
  /**
   * Turns YT Music on or off. Off, every request rejects with
   * `ERR_YT_DISABLED` before reaching the network. Kept natively, so the
   * playback service knows too.
   */
  setEnabled(on: boolean): void;
  isEnabled(): boolean;
  /** Songs on YT Music for [query] (YouTube Music's "Songs" filter). */
  searchSongs(query: string): Promise<NativeYtSearchPage>;
}

/** YT Music through innertubex (`modules/wave-native`, package `yt`). */
export const WaveYtMusic = requireNativeModule<WaveYtMusicModule>("WaveYtMusic");

/** The reason a YT Music request failed, from its rejection. */
export const ytErrorCode = (error: unknown): YtErrorCode => {
  const code = (error as { code?: unknown } | null)?.code;
  return code === "ERR_YT_OFFLINE" || code === "ERR_YT_DISABLED" ? code : "ERR_YT_FAILED";
};
