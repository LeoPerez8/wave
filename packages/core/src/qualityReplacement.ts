/**
 * Replacing the Library's songs with copies in another quality (docs/spec.md,
 * "YT Music" › Download quality): turning Download in best quality on offers
 * to replace low-quality files with Soulseek's MP3 320 (an upgrade); turning
 * it off offers to free space with YouTube Music's copies (a downgrade).
 * Which songs qualify, what the run costs in storage, the jobs that replace
 * them, and the memory of songs with no better copy.
 */

import type { DownloadOrigin } from "./downloadGroups.ts";
import type { DownloadSource } from "./downloadSource.ts";
import { advisoryTag, type ExplicitFlag } from "./explicit.ts";
import { UNKNOWN_ALBUM } from "./library.ts";
import { parseLyrics, type LyricsSources } from "./lyrics.ts";
import type { MissingTrack } from "./missingSongDownload.ts";
import type { YtDownloadTags } from "./ytDownload.ts";
import type { YtDownloadFailure, YtDownloadJournalJob } from "./ytDownloads.ts";
import { ytDownloadsFromJournal } from "./ytDownloads.ts";
import type { YtSong } from "./ytMusic.ts";

/** Which way a replacement goes: up to best quality, or down to free space. */
export type QualityDirection = "upgrade" | "downgrade";

/** A Library file as the replacement offer sees it. */
export interface QualityFile {
  /** Its Track. */
  readonly id: number;
  readonly path: string;
  /** 0 when unknown. */
  readonly durationMs: number;
  /** As the file's header says it; null when the scanner couldn't tell. */
  readonly bitrateKbps: number | null;
  /** 0 when unknown. */
  readonly sizeBytes: number;
}

/** What the offer leaves out besides the files' own quality. */
export interface QualityMemory {
  /** The Tracks recorded as having no better copy in this direction: never offered again. */
  readonly noBetterCopy: ReadonlySet<number>;
  /** The download journal: a song whose replacement is on its way isn't offered twice. */
  readonly jobs: readonly YtDownloadJournalJob[];
}

/** Under this a file is low quality: YouTube's ~128k, MP3s at 192k or less. */
export const LOW_QUALITY_BELOW_KBPS = 256;

/**
 * How far under [LOW_QUALITY_BELOW_KBPS] a header may average and the file
 * still count as 256k: an AAC 256k file's header gives its average, which
 * can land a little under.
 */
const HEADER_SLACK_KBPS = 8;

/** Files no replacement ever touches. */
const LOSSLESS = new Set(["flac", "wav", "wave", "aif", "aiff", "ape", "wv", "alac", "dsf", "dff"]);

const extensionOf = (path: string): string => {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  return dot <= 0 ? "" : name.slice(dot + 1).toLowerCase();
};

/** Whether [path] is a lossless file (FLAC and the like), which no replacement touches. */
export const isLosslessFile = (path: string): boolean => LOSSLESS.has(extensionOf(path));

const JOB_PREFIXES: { readonly [D in QualityDirection]: string } = {
  upgrade: "upgrade:",
  downgrade: "downgrade:",
};

/** The download journal's id for replacing Track [trackId] in [direction]: `upgrade:<id>`. */
export type QualityJobId = `${QualityDirection}:${number}`;

export const qualityJobId = (direction: QualityDirection, trackId: number): QualityJobId =>
  `${direction}:${trackId}`;

/** The replacement job [jobId] is, or null for any other job. */
export const qualityJobOf = (
  jobId: string,
): { readonly direction: QualityDirection; readonly trackId: number } | null => {
  for (const direction of ["upgrade", "downgrade"] as const) {
    const prefix = JOB_PREFIXES[direction];
    if (!jobId.startsWith(prefix)) continue;
    const id = jobId.slice(prefix.length);
    return /^\d+$/.test(id) ? { direction, trackId: Number(id) } : null;
  }
  return null;
};

/** Best quality: Soulseek's MP3 320. */
export const BEST_QUALITY_KBPS = 320;

/** The bytes [kbps] takes over [durationMs]. */
const bytesAt = (kbps: number, durationMs: number): number => (kbps * Math.max(0, durationMs)) / 8;

/** [file]'s size now: its own, else what its bitrate takes over its length. */
const sizeOf = (file: QualityFile): number =>
  file.sizeBytes > 0 ? file.sizeBytes : bytesAt(file.bitrateKbps ?? 0, file.durationMs);

/**
 * A size as the offer says it: whole MB under a GB, else GB with one decimal
 * ("900 MB", "1.2 GB"); never under 1 MB.
 */
export const formatStorageSize = (bytes: number): string => {
  const mb = Math.max(1, Math.round(bytes / 1e6));
  if (mb < 1000) return `${mb.toLocaleString("en")} MB`;
  return `${(bytes / 1e9).toFixed(1).replace(/\.0$/, "")} GB`;
};

/** The card a replacement run is offered with, and the Settings row that offers it again. */
export interface QualityOffer {
  readonly direction: QualityDirection;
  /** The songs it replaces, in order. */
  readonly trackIds: readonly number[];
  /** What storage changes by, about: more for an upgrade, less for a downgrade. */
  readonly bytes: number;
  /** What the run downloads, about. */
  readonly downloadBytes: number;
  /** "Replace 342 songs with best quality? About +1.2 GB", with Replace and Not now (Core's `planAlert`). */
  readonly alert: {
    readonly title: string;
    readonly message: string;
    readonly action: { readonly label: string };
    readonly dismissLabel: string;
  };
  /** Settings › Downloads' row while songs are left: "Replace 342 songs with best quality". */
  readonly row: string;
}

const songs = (count: number): string =>
  `${count.toLocaleString("en")} ${count === 1 ? "song" : "songs"}`;

/** What the card adds on mobile data: the run's size, and that the phone isn't on Wi-Fi. */
const mobileDataNote = (downloadBytes: number): string =>
  `It downloads about ${formatStorageSize(downloadBytes)}, and the phone isn't on Wi-Fi.`;

/**
 * Turning best quality on: the offer to replace [files] (`qualityUpgradeSongs`)
 * with MP3 320 copies, its estimate the difference to 320 kbps over their
 * lengths. On mobile data ([onMobileData]) the card says what the run
 * downloads. Null when no song qualifies.
 */
export const qualityUpgradeOffer = (
  files: readonly QualityFile[],
  { onMobileData }: { readonly onMobileData: boolean },
): QualityOffer | null => {
  if (files.length === 0) return null;
  let downloadBytes = 0;
  let bytes = 0;
  for (const file of files) {
    const best = bytesAt(BEST_QUALITY_KBPS, file.durationMs);
    downloadBytes += best;
    bytes += Math.max(0, best - sizeOf(file));
  }
  const estimate = `About +${formatStorageSize(bytes)}`;
  return {
    direction: "upgrade",
    trackIds: files.map((file) => file.id),
    bytes,
    downloadBytes,
    alert: {
      title: `Replace ${songs(files.length)} with best quality?`,
      message: onMobileData ? `${estimate}. ${mobileDataNote(downloadBytes)}` : estimate,
      action: { label: "Replace" },
      dismissLabel: "Not now",
    },
    row: `Replace ${songs(files.length)} with best quality`,
  };
};

/** The Tracks whose replacement in [direction] is queued, downloading or saving. */
const onTheirWay = (
  jobs: readonly YtDownloadJournalJob[],
  direction: QualityDirection,
): Set<number> => {
  const ids = new Set<number>();
  for (const { song, status } of ytDownloadsFromJournal(jobs).jobs) {
    const job = qualityJobOf(song.videoId);
    if (job === null || job.direction !== direction) continue;
    if (status.kind === "queued" || status.kind === "downloading" || status.kind === "saving")
      ids.add(job.trackId);
  }
  return ids;
};

/**
 * The files turning best quality on offers to replace: every one under 256
 * kbps, whoever put it there. AAC 256k, MP3 320 and lossless files stay, as
 * does one whose bitrate isn't known, one with no better copy, and one whose
 * upgrade is on its way.
 */
export const qualityUpgradeSongs = <F extends QualityFile>(
  files: readonly F[],
  { noBetterCopy, jobs }: QualityMemory,
): F[] => {
  const asked = onTheirWay(jobs, "upgrade");
  return files.filter(
    (file) =>
      file.bitrateKbps !== null &&
      file.bitrateKbps > 0 &&
      file.bitrateKbps < LOW_QUALITY_BELOW_KBPS - HEADER_SLACK_KBPS &&
      !isLosslessFile(file.path) &&
      !noBetterCopy.has(file.id) &&
      !asked.has(file.id),
  );
};

/**
 * Where replacement runs wait in Settings › Downloads (`downloadingList`):
 * "Quality upgrade" and "Free up space", reorderable and cancellable like
 * any other group.
 */
export const QUALITY_ORIGINS: { readonly [D in QualityDirection]: DownloadOrigin } = {
  upgrade: { kind: "quality", id: "upgrade", name: "Quality upgrade" },
  downgrade: { kind: "quality", id: "downgrade", name: "Free up space" },
};

/** A Library song as its replacement takes it: its Track's tags, its file, cover and advisory. */
export interface ReplacedTrack extends MissingTrack {
  /** The file it replaces. */
  readonly path: string;
  /** What its advisory tag says. */
  readonly explicit: ExplicitFlag;
  /** The Library's copy of its cover (the image as the file holds it); null without one. */
  readonly artworkPath: string | null;
}

const albumOf = (track: ReplacedTrack): string | null =>
  track.album === UNKNOWN_ALBUM || track.album === "" ? null : track.album;

/**
 * The journal's job replacing [track] in [direction], shaped as a YT Music
 * song so rows, matching and Soulseek's search take it as they take one: it
 * goes by `qualityJobId`, and searches by the Track's title, artists, album
 * and length.
 */
export const qualityReplacementJob = (
  direction: QualityDirection,
  track: ReplacedTrack,
): YtSong & { readonly videoId: QualityJobId } => ({
  videoId: qualityJobId(direction, track.id),
  title: track.title,
  artists: track.artists.length > 0 ? track.artists : [track.artist],
  album: albumOf(track),
  durationMs: track.durationMs > 0 ? track.durationMs : null,
  artworkUrl: null,
  explicit: false,
});

/** Where a replacement's file goes: beside the old one, under its name. */
export interface QualityReplacementTarget {
  readonly targetPath: string;
  /**
   * The old file, when the new one takes its very path (the same kind of
   * file): publishing moves it over the old one. Null when they differ; the
   * old one is deleted once the new one is in the Library.
   */
  readonly replaces: string | null;
}

/**
 * The new file of a replacement of the file at [path], from [source]
 * (Soulseek's MP3, YouTube Music's M4A): the same folder and name, so the
 * song stays where it was. A different extension is fine.
 */
export const qualityReplacementTarget = (
  path: string,
  source: DownloadSource,
): QualityReplacementTarget => {
  const extension = source === "soulseek" ? "mp3" : "m4a";
  if (extensionOf(path) === extension) return { targetPath: path, replaces: path };
  const slash = path.lastIndexOf("/");
  const dot = path.lastIndexOf(".");
  const stem = dot > slash + 1 ? path.slice(0, dot) : path;
  return { targetPath: `${stem}.${extension}`, replaces: null };
};

const text = (lyrics: string | null): string | null =>
  lyrics === null || lyrics.trim() === "" ? null : lyrics;

/**
 * The tags a replacement's file gets: the old file's, as the Library has
 * them, its cover (the Library's copy) and its lyrics, picked as the Lyrics
 * view picks them (Core's `pickLyrics`: synced lyrics in a sidecar win, else
 * the tags', else the sidecar's), so the owner's edits and Fix Song's fills
 * stay.
 */
export const qualityReplacementTags = (
  track: ReplacedTrack,
  lyrics: LyricsSources,
): YtDownloadTags => {
  const embedded = text(lyrics.embedded);
  const sidecar = text(lyrics.sidecar);
  const synced = sidecar !== null && parseLyrics(sidecar).kind === "synced";
  return {
    title: track.title,
    artist: track.artist,
    album: albumOf(track),
    albumArtist: track.albumArtist,
    year: track.year,
    trackNumber: track.trackNumber,
    discNumber: track.discNumber,
    genre: track.genre,
    lyrics: synced ? sidecar : (embedded ?? sidecar),
    artworkUrl: track.artworkPath,
    advisory: advisoryTag(track.explicit),
  };
};

/**
 * The failure a replacement's prepare answers with when it finds no better
 * copy (no Soulseek 320 candidate, no YouTube Music match): the song keeps
 * its file, and it isn't a failed download. Every peer failing (Soulseek's
 * `unavailable` once they're used up) is a failure after retries.
 */
export const NO_BETTER_COPY_FOUND: YtDownloadFailure = "notFound";

/**
 * Failures that are the phone's or the account's, not the song's: they'd fail
 * any download the same way, so the song is offered again.
 */
const NOT_THE_SONGS: readonly YtDownloadFailure[] = [
  "offline",
  "storage",
  "noFolder",
  "noSource",
  "account",
  "accountRejected",
  "unreachable",
];

/** [job]'s failure, or null while it hasn't failed. */
const failureOf = (job: YtDownloadJournalJob): YtDownloadFailure | null =>
  job.importFailure ?? (job.phase === "failed" ? (job.reason ?? "failed") : null);

/** Whether replacement job [job] failed because there's no better copy of its song. */
export const foundNoBetterCopy = (job: YtDownloadJournalJob): boolean => {
  const failure = failureOf(job);
  return qualityJobOf(job.id) !== null && failure === NO_BETTER_COPY_FOUND;
};

/** A song recorded as having no better copy in a direction. */
export interface NoBetterCopy {
  readonly direction: QualityDirection;
  readonly trackId: number;
}

/**
 * The songs the journal's replacement [jobs] found no better copy of: no 320
 * copy (or no YouTube Music match), or a failure after retries. Each keeps
 * its file and is never offered in that direction again. A failure that's
 * the phone's or the account's (offline, full storage, no source) isn't the
 * song's, and a cancel isn't a failure.
 */
export const noBetterCopies = (jobs: readonly YtDownloadJournalJob[]): NoBetterCopy[] =>
  jobs.flatMap((job) => {
    const replacement = qualityJobOf(job.id);
    const failure = failureOf(job);
    return replacement === null || failure === null || NOT_THE_SONGS.includes(failure)
      ? []
      : [replacement];
  });

/**
 * Turning the switch back: the replacements in [direction] to cancel, those
 * queued or downloading. One already saving finishes.
 */
export const qualityJobsToCancel = (
  jobs: readonly YtDownloadJournalJob[],
  direction: QualityDirection,
): string[] =>
  ytDownloadsFromJournal(jobs).jobs.flatMap(({ song, status }) =>
    qualityJobOf(song.videoId)?.direction === direction &&
    (status.kind === "queued" || status.kind === "downloading")
      ? [song.videoId]
      : [],
  );
