/**
 * A streamed YouTube Music song's menu (`window.wave.streamed`), as the phone gives it: Core's
 * `ytSongActions` and `ytDownloadActions`, and Now Playing's Download button for it.
 */
import type { NowPlayingDownload, StreamedArtistTarget } from "@wave/core";
import type { Invoke } from "./bridge.ts";
import type { SongRunResult } from "./songActions.ts";

/** A Library artist a streamed song's artist name is. */
export interface StreamedArtist {
  readonly id: number;
  readonly name: string;
}

/** Where Go to Artist leads: one artist, or a choice; a YT Music one is found by name. */
export type StreamedArtistChoice =
  | { readonly kind: "open"; readonly target: StreamedArtistTarget<StreamedArtist> }
  | { readonly kind: "choose"; readonly targets: readonly StreamedArtistTarget<StreamedArtist>[] };

/** The entries main runs on a streamed song. */
export const STREAMED_RUN_ACTIONS = [
  "playNext",
  "addToQueue",
  "favorite",
  "unfavorite",
  "addToPlaylist",
  "download",
  "cancelDownload",
  "retryDownload",
] as const;
export type StreamedRunAction = (typeof STREAMED_RUN_ACTIONS)[number];

/** One entry, in the phone's order; the window opens pages, the Magic Queue and Copy Link. */
export type StreamedEntry =
  | { readonly action: StreamedRunAction | "magicQueue" | "share" }
  | { readonly action: "goToAlbum"; readonly album: string }
  | { readonly action: "goToArtist"; readonly artists: StreamedArtistChoice };

export interface StreamedSongMenu {
  readonly title: string;
  readonly entries: readonly StreamedEntry[];
  /** Starred: a pending favorite, or the Library's song for it starred. */
  readonly favorite: boolean;
  /** Now Playing's Download button (Core's `nowPlayingDownload`). */
  readonly download: NowPlayingDownload;
}

/** What a run did, for its toast: Core's toasts as the Library's songs give them. */
export type StreamedRunResult = Exclude<
  SongRunResult,
  { readonly kind: "removed" | "playlistRemoved" | "fixed" }
>;

export interface StreamedContract {
  /** The menu of a song a page or the queue brought; [playing] for the song playing. */
  readonly "streamed.menu": {
    readonly args: readonly [videoId: string, playing: boolean];
    readonly result: StreamedSongMenu;
  };
  readonly "streamed.run": {
    readonly args: readonly [videoId: string, action: StreamedRunAction, playlistId?: number];
    readonly result: StreamedRunResult;
  };
}

export const STREAMED_CALLS = ["streamed.menu", "streamed.run"] as const;

export const streamedBridge = (invoke: Invoke) => ({
  menu: (videoId: string, playing = false) => invoke("streamed.menu", videoId, playing),
  run: (videoId: string, action: StreamedRunAction, playlistId?: number) =>
    invoke("streamed.run", videoId, action, playlistId),
});
