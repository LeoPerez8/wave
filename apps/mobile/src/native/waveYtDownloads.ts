import type { YtAlbum, YtAlbumTrack } from "@wave/core";
import { NativeModule, requireNativeModule } from "expo";

import type { NativeArtwork, NativeScannedTrack } from "./waveNative";

/** A song on a YT Music album page, as the native parser reads it. */
export interface NativeYtAlbumTrack extends YtAlbumTrack {
  /** Its own credit, else the album's. */
  readonly artists: readonly string[];
  readonly durationMs: number | null;
  readonly explicit: boolean;
}

/** A YT Music album page (`MPREb_…`) with the first page of its tracklist. */
export interface NativeYtAlbum extends YtAlbum {
  /** The album's playlist (`OLAK5uy_…`), which plays it in order. */
  readonly playlistId: string | null;
  readonly tracks: readonly NativeYtAlbumTrack[];
}

/** What a song's watch page says about it. */
export interface NativeYtWatchSong {
  readonly albumId: string | null;
  /** Where YT Music keeps the song's lyrics, when it has some. */
  readonly lyricsBrowseId: string | null;
}

/** A download the native journal saved into the Library: where it went, read as a scan reads it. */
export interface NativeSavedDownload {
  readonly path: string;
  readonly track: NativeScannedTrack;
  readonly artwork: NativeArtwork | null;
}

/**
 * The codes a download rejects with: YT Music's (`ERR_YT_OFFLINE`,
 * `ERR_YT_FAILED`, `ERR_YT_DISABLED`), a cancelled download, or a file that
 * couldn't be saved.
 */
export type YtDownloadErrorCode =
  "ERR_YT_OFFLINE" | "ERR_YT_FAILED" | "ERR_YT_DISABLED" | "ERR_YT_CANCELLED" | "ERR_YT_STORAGE";

declare class WaveYtDownloadsModule extends NativeModule {
  album(browseId: string): Promise<NativeYtAlbum>;
  watchSong(videoId: string): Promise<NativeYtWatchSong>;
  /** YT Music's lyrics at [browseId], plain text; null when there are none. */
  lyrics(browseId: string): Promise<string | null>;
}

/** Downloading YT Music songs (`modules/wave-native`, `YtDownloadModule`). */
export const WaveYtDownloads = requireNativeModule<WaveYtDownloadsModule>("WaveYtDownloads");

/** The reason a download step failed, from its rejection. */
export const ytDownloadErrorCode = (error: unknown): YtDownloadErrorCode => {
  const code = (error as { code?: unknown } | null)?.code;
  switch (code) {
    case "ERR_YT_OFFLINE":
    case "ERR_YT_DISABLED":
    case "ERR_YT_CANCELLED":
    case "ERR_YT_STORAGE":
      return code;
    default:
      return "ERR_YT_FAILED";
  }
};
