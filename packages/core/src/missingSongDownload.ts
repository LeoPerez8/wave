/**
 * Downloading missing songs (docs/spec.md, "Wave account and sync" ›
 * Downloading missing songs): a missing song's download job, where its
 * audio comes from, the tags its file gets, and what Settings › Wave
 * Account's Download All offers. Each song goes through the download
 * pipeline YT Music songs use, in a job named after its Track, so the file
 * fills that Track in.
 */

import { UNKNOWN_ALBUM } from "./library.ts";
import { songLookup, type FoundTags, type SongLookup } from "./lyricsAndGenre.ts";
import { spotifySearchQuery, spotifyYtMatch } from "./spotifyImport.ts";
import { largeCover, type YtDownloadTags } from "./ytDownload.ts";
import type { YtSong } from "./ytMusic.ts";

/** A missing song as a download takes it: its Track's tags, as the Library keeps them. */
export interface MissingTrack {
  /** Its Track: the file fills this Track in. */
  readonly id: number;
  readonly title: string;
  /** Its artist credit, as one line. */
  readonly artist: string;
  /** The artists the credit names, the main artist first. */
  readonly artists: readonly string[];
  /** `Unknown Album` without one. */
  readonly album: string;
  readonly albumArtist: string;
  readonly year: number | null;
  readonly trackNumber: number | null;
  readonly discNumber: number | null;
  readonly genre: string | null;
  /** 0 when unknown. */
  readonly durationMs: number;
  /** The YouTube Music video it was downloaded from, when it was. */
  readonly videoId: string | null;
}

/** What a missing song's job keeps of its Track besides what a YT Music song has. */
export interface MissingSongJobTags {
  /** The Track the download fills in. */
  readonly trackId: number;
  readonly artist: string;
  readonly album: string;
  readonly albumArtist: string;
  readonly year: number | null;
  readonly trackNumber: number | null;
  readonly discNumber: number | null;
  readonly genre: string | null;
  readonly videoId: string | null;
}

/**
 * A missing song as the download journal holds it: shaped like a YT Music
 * song, so rows, matching and the journal take it as they take one, but
 * named after its Track ([videoId] is the job's id, never a video's).
 */
export interface MissingSongJob extends YtSong {
  readonly missing: MissingSongJobTags;
}

/** The download job of the missing song whose Track is [trackId]. */
export const missingSongJobId = (trackId: number): string => `missing:${trackId}`;

/** The job that downloads missing song [track]. */
export const missingSongJob = (track: MissingTrack): MissingSongJob => ({
  videoId: missingSongJobId(track.id),
  title: track.title,
  artists: track.artists.length > 0 ? track.artists : [track.artist],
  album: track.album === UNKNOWN_ALBUM || track.album === "" ? null : track.album,
  durationMs: track.durationMs > 0 ? track.durationMs : null,
  artworkUrl: null,
  explicit: false,
  missing: {
    trackId: track.id,
    artist: track.artist,
    album: track.album,
    albumArtist: track.albumArtist,
    year: track.year,
    trackNumber: track.trackNumber,
    discNumber: track.discNumber,
    genre: track.genre,
    videoId: track.videoId,
  },
});

/**
 * What YouTube Music is searched for to find missing song [job]'s video:
 * its title and artists, all that is sent; null for a song with a video id,
 * which downloads that video.
 */
export const missingSongSearch = (job: MissingSongJob): string | null =>
  job.missing.videoId === null ? spotifySearchQuery(job) : null;

/** A YouTube Music video a missing song downloads, and its cover when YouTube Music showed one. */
export interface MissingSongVideo {
  readonly videoId: string;
  readonly artworkUrl: string | null;
}

/**
 * The video missing song [job] downloads from YouTube Music: the one it was
 * downloaded from before, else the first of YouTube Music's [results] for
 * `missingSongSearch` that is the recording, by the rules downloads use
 * (`spotifyYtMatch`: title, main artist, edition, and length within 3
 * seconds). Null when nothing is, or nothing was searched.
 */
export const missingSongVideo = (
  job: MissingSongJob,
  results: readonly YtSong[] | null,
): MissingSongVideo | null => {
  if (job.missing.videoId !== null) return { videoId: job.missing.videoId, artworkUrl: null };
  const match = results === null ? null : spotifyYtMatch(job, results);
  return match === null ? null : { videoId: match.videoId, artworkUrl: match.artworkUrl };
};

/** What missing song [job]'s lyrics and genre are looked up by; null when it can't be told apart. */
export const missingSongLookup = (job: MissingSongJob): SongLookup | null =>
  songLookup({
    title: job.title,
    artist: job.missing.artist,
    album: job.missing.album,
    durationMs: job.durationMs ?? 0,
  });

/**
 * The tags missing song [job]'s file gets: its Track's, so the file is the
 * same recording for the Wave account (Core's `recordingKey`), with what
 * the Track has no tag for from the lookup's [found] (lyrics, and a genre,
 * year or track number) and the cover of the video it comes from
 * ([artworkUrl], asked for large), when there is one.
 */
export const missingSongTags = (
  job: MissingSongJob,
  found: FoundTags | null,
  artworkUrl: string | null,
): YtDownloadTags => {
  const { missing } = job;
  // The number and its disc come from one source: the Track, else the lookup.
  const place =
    missing.trackNumber !== null
      ? { trackNumber: missing.trackNumber, discNumber: missing.discNumber }
      : { trackNumber: found?.trackNumber ?? null, discNumber: found?.discNumber ?? null };
  return {
    title: job.title,
    artist: missing.artist,
    album: job.album,
    albumArtist: missing.albumArtist,
    year: missing.year ?? found?.year ?? null,
    ...place,
    genre: missing.genre ?? found?.genre ?? null,
    lyrics: found?.lyrics?.text ?? null,
    artworkUrl: artworkUrl === null ? null : largeCover(artworkUrl),
  };
};
