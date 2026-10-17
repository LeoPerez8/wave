/**
 * Downloading an unsearched entry (docs/spec.md, YT Music, "Playlist
 * downloads"): a song a Spotify import listed that nothing has searched on
 * YouTube Music yet. It joins the download queue as a job named after what
 * Spotify listed (`unsearchedTrackId`), and its source follows the rule for
 * a song without a video (`downloadSource`): Soulseek by its title and
 * artists, YouTube Music's search when that's the source or Soulseek can't
 * deliver. That search settles the entry as playing's does.
 */

import {
  isUnsearchedTrackId,
  readUnsearchedTrackId,
  unsearchedTrackId,
  type UnsearchedSong,
} from "./playlistEntries.ts";
import type { YtAlbumSong } from "./ytDiscover.ts";

import type { UnsearchedSettlement } from "./unsearchedEntries.ts";
import type { YtDownloadFailure } from "./ytDownloads.ts";
import type { SearchFailure } from "./searchAllowance.ts";

/** The download journal's id for an unsearched song's job: its `unsearchedTrackId`. */
export type UnsearchedSongJobId = `unsearched:${string}`;

/**
 * An unsearched song as the download journal holds it: shaped like a YT
 * Music song, so rows, matching and the journal take it as they take one.
 * The journal names a job after its song's `videoId`, so that field holds
 * the job's id; it names no video, and has no album page.
 */
export interface UnsearchedSongJob extends YtAlbumSong {
  readonly videoId: UnsearchedSongJobId;
  readonly albumId: null;
}

/** The job that downloads unsearched song [song]: what Spotify listed, under its unsearched id. */
export const unsearchedSongJob = ({
  title,
  artists,
  album,
  durationMs,
  artworkUrl,
}: UnsearchedSong): UnsearchedSongJob => ({
  videoId: unsearchedTrackId({
    title,
    artists,
    album,
    durationMs,
    artworkUrl,
  }) as UnsearchedSongJobId,
  title,
  artists,
  album,
  durationMs,
  artworkUrl,
  explicit: false,
  albumId: null,
});

/** Whether download job [jobId] is an unsearched song's (`unsearchedSongJob`). */
export const isUnsearchedSongJob = (jobId: string): jobId is UnsearchedSongJobId =>
  isUnsearchedTrackId(jobId);

/**
 * The unsearched song download job [jobId] downloads, as Spotify listed it
 * (the id says all but the cover, which the job's [song] keeps); null for
 * any other job.
 */
export const unsearchedJobSong = (
  jobId: string,
  song: { readonly artworkUrl: string | null },
): UnsearchedSong | null => {
  const listed = readUnsearchedTrackId(jobId);
  return listed === null ? null : { ...listed, artworkUrl: song.artworkUrl };
};

/**
 * What an unsearched song's download does once its YouTube Music search
 * settled it (`settleUnsearched`): found, it downloads the video found, a
 * Songs search result and so the song's audio track, with no second search
 * for one; [song] is what it is tagged as, what the entry kept (title,
 * artists, album, length, Spotify's cover) under that video and the album
 * page YouTube Music files it under. Not found, or the search failed, the
 * download fails, with why.
 */
export type UnsearchedDownload<S extends YtAlbumSong> =
  | {
      readonly kind: "download";
      readonly found: S;
      readonly video: string;
      readonly song: YtAlbumSong;
    }
  | { readonly kind: "fail"; readonly failure: YtDownloadFailure };

/** A failed search as a download's failure: YT Music off is no source to download from. */
const SEARCH_FAILURES: { readonly [F in SearchFailure]: YtDownloadFailure } = {
  offline: "offline",
  failed: "failed",
  disabled: "noSource",
};

/** What [song]'s download does, its search having settled it as [settlement]. */
export const unsearchedDownload = <S extends YtAlbumSong>(
  song: UnsearchedSong,
  settlement: UnsearchedSettlement<S>,
): UnsearchedDownload<S> => {
  switch (settlement.kind) {
    case "found": {
      const found = settlement.becomes.song;
      return {
        kind: "download",
        found,
        video: found.videoId,
        song: {
          videoId: found.videoId,
          title: song.title,
          artists: song.artists,
          album: song.album,
          albumId: found.albumId,
          durationMs: song.durationMs,
          artworkUrl: song.artworkUrl,
          explicit: found.explicit,
        },
      };
    }
    case "notFound":
      return { kind: "fail", failure: "notFound" };
    case "failed":
      return { kind: "fail", failure: SEARCH_FAILURES[settlement.reason] };
  }
};
