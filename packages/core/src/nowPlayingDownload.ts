import { isExplicit, type ExplicitFlag } from "./explicit.ts";
import { UNKNOWN_ALBUM } from "./library.ts";
import { videoCoverUrl } from "./streamedCover.ts";
import { ytDownloadProgress, type YtDownloadStatus } from "./ytDownloads.ts";
import { parseTrackId, type YtSong } from "./ytMusic.ts";

/**
 * What Now Playing's Download button shows for the song playing: Download,
 * waiting, a progress ring ([fraction] of the file received), failed (a tap
 * retries), or downloaded (tinted; a tap only says so) once the Library has a
 * file for it.
 */
export type NowPlayingDownload =
  | { readonly kind: "download" }
  | { readonly kind: "waiting" }
  | { readonly kind: "progress"; readonly fraction: number }
  | { readonly kind: "failed" }
  | { readonly kind: "downloaded" };

/**
 * Now Playing's Download button for the song playing, given its download's
 * [status] and whether the Library has a file for it ([hasFile]).
 */
export const nowPlayingDownload = (
  status: YtDownloadStatus | null,
  { hasFile }: { readonly hasFile: boolean },
): NowPlayingDownload => {
  if (hasFile) return { kind: "downloaded" };
  switch (status?.kind) {
    case undefined:
      return { kind: "download" };
    case "queued":
      return { kind: "waiting" };
    case "downloading": {
      const fraction = ytDownloadProgress(status);
      return fraction === null ? { kind: "waiting" } : { kind: "progress", fraction };
    }
    case "saving":
      return { kind: "progress", fraction: 1 };
    case "failed":
      return { kind: "failed" };
    // In the Library, or about to be once it's read again.
    case "done":
      return { kind: "downloaded" };
  }
};

/**
 * What a tap on Now Playing's Download button does for the song playing,
 * given the Library's song for it ([track], null when the Library hasn't got
 * it) and the YT Music song it streams ([song], null for a Library track):
 * - `delete`: a song with a file; the song menu's Delete, its confirmation
 *   first (the owner's own files too);
 * - `missing`: a missing song; it downloads into its Library entry;
 * - `stream`: a YT Music song the Library hasn't got; it downloads as a new song;
 * - `gone`: a Library song that has left the Library meanwhile.
 * Waiting and downloading, the button has no tap.
 */
export type NowPlayingDownloadTap<T, S> =
  | { readonly kind: "delete"; readonly track: T & { readonly path: string } }
  | { readonly kind: "missing"; readonly id: number }
  | { readonly kind: "stream"; readonly song: S }
  | { readonly kind: "gone" };

export const nowPlayingDownloadTap = <
  T extends { readonly id: number; readonly path: string | null },
  S,
>(
  track: T | null,
  song: S | null,
): NowPlayingDownloadTap<T, S> => {
  if (track !== null) {
    return track.path !== null
      ? { kind: "delete", track: track as T & { readonly path: string } }
      : { kind: "missing", id: track.id };
  }
  return song !== null ? { kind: "stream", song } : { kind: "gone" };
};

/**
 * What the song playing goes on as once Now Playing's Download deleted its
 * file, [playing] being its queue entry's track id and [track] the Library
 * song deleted: the YT Music song of the video it was downloaded from
 * ([videoId]), streamed from about where it was, when it played from the
 * file and YouTube Music is on. Null when the delete moves the queue on to
 * the next song (no YouTube id, or YouTube Music off), as the menu's Delete
 * does, or when it was streamed already and plays on as it was.
 */
export const streamedAfterDelete = (
  playing: string,
  track: {
    readonly id: number;
    readonly title: string;
    readonly artist: string;
    readonly album: string | null;
    readonly durationMs: number;
    readonly explicit: ExplicitFlag;
  },
  { videoId, ytMusicOn }: { readonly videoId: string | null; readonly ytMusicOn: boolean },
): YtSong | null => {
  const ref = parseTrackId(playing);
  if (ref?.kind !== "library" || ref.id !== track.id) return null;
  if (videoId === null || !ytMusicOn) return null;
  return {
    videoId,
    title: track.title,
    artists: [track.artist],
    album: track.album === null || track.album === UNKNOWN_ALBUM ? null : track.album,
    durationMs: track.durationMs > 0 ? track.durationMs : null,
    artworkUrl: videoCoverUrl(videoId),
    explicit: isExplicit(track.explicit),
  };
};
