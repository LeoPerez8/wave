/**
 * The Download menu and rows of YT Music songs, backed by the native journal: Core picks the
 * source (`downloadSource`), Soulseek's automatic recording selection or YouTube Music's M4A,
 * and what the journal does when a source fails, YouTube Music's fallback included
 * (`downloadFailurePlan`).
 */
import {
  FAVORITES_DOWNLOAD_ORIGIN,
  YT_DOWNLOADS_NONE,
  qualityDirection,
  applyJournalChanges,
  readStarDownloads,
  starAskedAfter,
  starredDownload,
  unstarredDownload,
  writeStarDownloads,
  downloadFailureAnswer,
  downloadJobKind,
  downloadTagWriteOrigin,
  downloadFailurePlan,
  downloadSource,
  downloadStorageFull,
  failedDownloadCount,
  failedDownloads,
  isWithin,
  libraryFinder,
  listedSongTags,
  missingSongJob,
  missingSongJobId,
  missingSongLookup,
  missingSongSearch,
  missingSongTags,
  missingSongVideo,
  missingSongsDownload,
  downloadingList,
  failedReplacementFiles,
  moveQueuedJobs,
  NO_BETTER_COPY_FOUND,
  noBetterCopies,
  QUALITY_ORIGINS,
  qualityDowngradeSearch,
  qualityDowngradeVideo,
  qualityJobId,
  qualityJobsToCancel,
  qualityReplacementJob,
  qualityReplacementTags,
  qualityReplacementTarget,
  queuedDownloads,
  settledDownloadFailures,
  throttledFailures,
  throttledFailuresLine,
  soulseekCandidates,
  soulseekQuery,
  soulseekReceivedMatches,
  soulseekRecording,
  settleUnsearched,
  spotifySearchQuery,
  unsearchedDownload,
  unsearchedJobSong,
  unsearchedSearchQuery,
  ytAlbumDownload,
  ytAudioRejection,
  ytAudioTrack,
  ytDownloadDestination,
  ytDownloadHas,
  ytDownloadLookup,
  ytDownloadReport,
  ytDownloadSharedJob,
  ytDownloadStatus,
  ytDownloadTags,
  ytDownloadsFromJournal,
  ytDownloadsToForget,
  ytPlaylistDownload,
  ytSongsDownload,
  type DownloadFailurePlan,
  type DownloadOrigin,
  type DownloadSource,
  type DownloadingList,
  type FailedDownload,
  type FailedDownloadsInput,
  type MissingSongJob,
  type MissingSongVideo,
  type MissingSongsDownload,
  type MissingSongsDownloadAction,
  type MissingTrack,
  type PlaylistItem,
  type QualityDirection,
  type QueuedDownload,
  type QueuedDownloadCounts,
  type ReplacedTrack,
  type SoulseekCandidate,
  type UnsearchedSong,
  type YtAlbumDownload,
  type YtAlbumSong,
  type YtAlbumDownloadAction,
  type YtPlaylistDownload,
  type YtPlaylistDownloadAction,
  type YtDownloadFailure,
  type YtDownloadStatus,
  type YtDownloadTags,
  type YtDownloads,
  type YtSong,
  type YtSongSearch,
} from "@wave/core";
import * as Cause from "effect/Cause";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import { Storage } from "expo-sqlite/kv-store";
import { useMemo, useSyncExternalStore } from "react";

import { appLog } from "@/log/appLog";

import { askForNotifications } from "@/lib/askForNotifications";
import { persistedSetting } from "@/lib/persistedSetting";
import {
  libraryVersion,
  songsFilledIn,
  songsLanded,
  toIndexedArtwork,
  toIndexedTrack,
} from "@/library/LibraryScan";
import { publishSavedStars, publishYtSongSignal } from "@/library/libraryChanges";
import { LibraryStore, type SongRow } from "@/library/LibraryStore";
import { useLoadedMissingSongs, useMissingSongs } from "@/library/hooks";
import { refreshDownloadPolicy } from "@/library/downloadPolicy";
import { finishFileDeletions } from "@/library/fileDeletions";
import { replacementJournalRead } from "@/library/replacementDuplicates";
import { fillInLyricsAndGenre, lookUpLyricsAndGenre } from "@/library/lyricsAndGenre";
import { appRuntime } from "@/library/runtime";
import { settleUnsearchedSong } from "@/library/unsearchedEntries";
import { makeExternalStore } from "@/lib/externalStore";
import { WaveNative } from "@/native/waveNative";
import {
  WaveSoulseek,
  enqueueJobs,
  soulseekErrorCode,
  type JobRequest,
  type NativeDownloadDecision,
  type NativeDownloadJob,
  type NativeYoutubeAudio,
  type SoulseekSession,
} from "@/native/waveSoulseek";
import type { NativeYtSong } from "@/native/waveYtMusic";
import {
  WaveYtDownloads,
  ytDownloadErrorCode,
  type NativeSavedDownload,
  type NativeYtWatchSong,
} from "@/native/waveYtDownloads";
import { ytMusicEnabled } from "@/settings/ytMusic";

import { readYtAlbum } from "./albumPages";
import { failedJobsNow, journal, queuedCountsNow } from "./downloadJournal";
import { followDownloadRuns } from "./downloadRun";
import { useLoadedLibraryFinder } from "./libraryFinder";
import { followYoutubeThrottle } from "./youtubeThrottle";
import { withSearchTurn } from "./searchAllowance";
import { YtMusic, type YtMusicError } from "./YtMusic";

export class DownloadFailed extends Data.TaggedError("DownloadFailed")<{
  readonly reason: YtDownloadFailure;
  readonly cause?: unknown;
}> {}

const failure = (cause: unknown): DownloadFailed => {
  const code = soulseekErrorCode(cause) ?? ytDownloadErrorCode(cause);
  return new DownloadFailed({
    reason:
      code === "ERR_SLSK_SIGNED_OUT"
        ? "account"
        : code === "ERR_SLSK_AUTH"
          ? "accountRejected"
          : code === "ERR_SLSK_UNREACHABLE"
            ? "unreachable"
            : code === "ERR_SLSK_OFFLINE" || code === "ERR_YT_OFFLINE"
              ? "offline"
              : code === "ERR_SLSK_STORAGE" || code === "ERR_YT_STORAGE"
                ? "storage"
                : code === "ERR_SLSK_INVALID_AUDIO" ||
                    code === "ERR_SLSK_PEER" ||
                    code === "ERR_SLSK_QUEUED"
                  ? "unavailable"
                  : "failed",
    cause,
  });
};
/** The Library's database failing a download: storage only when the phone is full (Core's `downloadStorageFull`). */
const libraryFailure = (cause: unknown): DownloadFailed =>
  new DownloadFailed({ reason: downloadStorageFull(cause) ? "storage" : "failed", cause });
const native = <A>(call: () => Promise<A>): Effect.Effect<A, DownloadFailed> =>
  Effect.tryPromise({ try: call, catch: failure });
const optional = <A>(effect: Effect.Effect<A, unknown>): Effect.Effect<A | null> =>
  effect.pipe(
    Effect.timeout("3 seconds"),
    Effect.orElseSucceed(() => null),
  );

/**
 * Optional metadata cannot fail or indefinitely hold up valid audio acquisition. The watch page
 * is asked for at most once (for the album, then YT Music's lyrics), and YT Music's lyrics only
 * when LRCLIB has none. Lyrics the Lyrics view found for the song's video are reused, with no
 * lyrics request at all (Core's `ytDownloadHas`, `ytDownloadTags`).
 */
const metadata = (song: NativeYtSong) =>
  Effect.gen(function* () {
    const store = yield* LibraryStore;
    const saved = yield* optional(store.savedLyrics(song.videoId));
    const has = ytDownloadHas(saved);
    let watchPage: Promise<NativeYtWatchSong> | undefined;
    const watch = () => native(() => (watchPage ??= WaveYtDownloads.watchSong(song.videoId)));
    const album = yield* optional(
      Effect.gen(function* () {
        const albumId = song.albumId ?? (yield* watch()).albumId;
        return albumId === null ? null : yield* native(() => readYtAlbum(albumId));
      }),
    );
    const lookup = ytDownloadLookup(song, album);
    const found = lookup === null ? null : yield* optional(lookUpLyricsAndGenre(lookup, has));
    const lyrics =
      has.hasLyrics || (found !== null && found.lyrics !== null)
        ? null
        : yield* optional(
            Effect.gen(function* () {
              const { lyricsBrowseId } = yield* watch();
              return lyricsBrowseId === null
                ? null
                : yield* native(() => WaveYtDownloads.lyrics(lyricsBrowseId));
            }),
          );
    return ytDownloadTags(song, album, found, lyrics, saved);
  });

/**
 * Core's source for a download now: YT Music's setting and Download in best quality (Soulseek's
 * [session]), and for a missing song whether it has its own [video].
 */
const currentSource = (
  session: SoulseekSession,
  ytMusicOn = ytMusicEnabled(),
  video = false,
): DownloadSource | null =>
  downloadSource({ ytMusicOn, bestQuality: session.status !== "off", video });

/** Soulseek's session now; off when the module can't tell. */
const sessionNow = async (): Promise<SoulseekSession> => {
  try {
    return await WaveSoulseek.session();
  } catch {
    return { status: "off", username: null };
  }
};

/**
 * What the journal keeps to carry a Soulseek job on from YouTube Music: where the M4A goes and
 * what it does when YouTube fails too. The failures that hand the job over are in the Soulseek
 * plan (`fallsBack`).
 */
interface DownloadFallbackPlan {
  readonly source: "youtube";
  /** The video it downloads, for a job not named after one (a missing song's). */
  readonly video?: string;
  /**
   * YouTube's turn starts with a prepare decision (`prepareFallback`), which names the video it
   * downloads: a song's audio track, looked up only once Soulseek has handed the job over.
   */
  readonly prepare?: true;
  readonly targetPath: string;
  readonly failurePlan: DownloadFailurePlan;
}

/** The journal's answer to "prepare": a plan, or Soulseek's failure with what falls back from it. */
type PrepareAnswer =
  | {
      readonly source: DownloadSource;
      /**
       * The video YouTube Music downloads instead of the job's own: a missing song's, or a
       * song's audio track (`audioTrack`).
       */
      readonly video?: string;
      readonly candidates: readonly SoulseekCandidate[];
      readonly tags: YtDownloadTags;
      readonly targetPath: string;
      readonly failurePlan: DownloadFailurePlan;
      readonly fallback?: DownloadFallbackPlan;
    }
  | {
      readonly failure: YtDownloadFailure;
      readonly tags: YtDownloadTags;
      readonly failurePlan: DownloadFailurePlan;
      readonly fallback?: DownloadFallbackPlan;
    };

/** The source a download is asked for with; the prepare decision decides again when it starts. */
const requestedSource = async (): Promise<DownloadSource | null> =>
  currentSource(await sessionNow());

/**
 * The journal's "prepare" decision: the source, the song's tags and where it goes, and for
 * Soulseek the peers with this recording. It carries Core's plan for the source's failures, and
 * a Soulseek job also YouTube Music's fallback while YT Music is on, with its answer or with
 * Soulseek's failure, so the journal can hand it over when Soulseek can't deliver the song.
 */
export const prepareDownload = (song: NativeYtSong) =>
  Effect.gen(function* () {
    const store = yield* LibraryStore;
    const [roots, excludedFolders] = yield* Effect.all([
      store.listRoots,
      store.excludedFolders,
    ]).pipe(Effect.mapError(libraryFailure));
    if (roots.length === 0) return yield* new DownloadFailed({ reason: "noFolder" });
    const ytMusicOn = ytMusicEnabled();
    const source = currentSource(yield* native(() => WaveSoulseek.session()), ytMusicOn);
    if (source === null) return yield* new DownloadFailed({ reason: "noSource" });
    if (source === "youtube") {
      const [tags, video] = yield* Effect.all([metadata(song), audioTrack(song)], {
        concurrency: "unbounded",
      });
      const target = ytDownloadDestination(roots, excludedFolders, tags, source);
      if (target === null) return yield* new DownloadFailed({ reason: "noFolder" });
      return {
        source,
        ...(video === undefined ? {} : { video }),
        candidates: [],
        tags,
        targetPath: target.path,
        failurePlan: downloadFailurePlan(source, { ytMusicOn }),
      } satisfies PrepareAnswer;
    }
    // YouTube Music's fallback looks up the song's audio track once it starts (`prepareFallback`).
    const [found, tags] = yield* Effect.all([searchSoulseek(song), metadata(song)], {
      concurrency: "unbounded",
    });
    return yield* soulseekAnswer(song, found, tags, { roots, excludedFolders }, ytMusicOn, {
      prepare: true,
    });
  });

/**
 * The journal's "prepare" decision for a Soulseek job it handed over to YouTube Music
 * (`fellBackFrom`): the video it downloads, the song's audio track, now that YouTube's turn has
 * come. The tags and the M4A's place are the ones Soulseek's prepare answer planned. With YT
 * Music turned off since, there's no source, and Soulseek's failure stands.
 */
const prepareFallback = (claim: NativeDownloadDecision) =>
  Effect.gen(function* () {
    if (!ytMusicEnabled()) return yield* new DownloadFailed({ reason: "noSource" });
    const { tags, targetPath } = claim;
    if (tags === undefined || targetPath === undefined)
      return yield* new DownloadFailed({ reason: "failed" });
    const unsearched = unsearchedJobSong(claim.id, claim.song);
    if (unsearched !== null) return yield* prepareUnsearchedFallback(claim, unsearched, targetPath);
    const video = yield* audioTrack(claim.song);
    return {
      source: "youtube",
      ...(video === undefined ? {} : { video }),
      candidates: [],
      tags,
      targetPath,
      failurePlan: downloadFailurePlan("youtube", { ytMusicOn: true }),
    } satisfies PrepareAnswer;
  });

/**
 * `prepareFallback` for unsearched song [song]: its YouTube Music search, now that Soulseek
 * couldn't deliver it, settles it and names the video (`unsearchedVideo`), and the song is
 * tagged as a YT Music song's download is, with the album page the video is filed under. The
 * M4A keeps the place Soulseek's prepare planned ([plannedPath]) when the tags leave none.
 */
const prepareUnsearchedFallback = (
  claim: NativeDownloadDecision,
  song: UnsearchedSong,
  plannedPath: string,
) =>
  Effect.gen(function* () {
    const found = yield* unsearchedVideo(claim.id, song);
    const tags = yield* metadata(found.song);
    const { roots, excludedFolders } = yield* refreshDownloadPolicy;
    const target = ytDownloadDestination(roots, excludedFolders, tags, "youtube");
    return {
      source: "youtube",
      video: found.video,
      candidates: [],
      tags,
      targetPath: target?.path ?? plannedPath,
      failurePlan: downloadFailurePlan("youtube", { ytMusicOn: true }),
    } satisfies PrepareAnswer;
  });

/**
 * The video a YouTube download of [song] asks for in place of its own: its audio track, from a
 * YT Music Songs search (Core's `ytAudioTrack`). YT Music's album pages may list a song under
 * its music video, whose audio isn't the album cut's length. Undefined keeps the song's own
 * video, as a search that fails does: the length check still judges what it serves.
 */
const audioTrack = (song: YtSong) =>
  Effect.gen(function* () {
    const ytMusic = yield* YtMusic;
    const query = spotifySearchQuery(song);
    const page = yield* withSearchTurn("download", query, ytMusic.searchSongs(query)).pipe(
      Effect.orElseSucceed(() => null),
    );
    return ytAudioTrack(song, page?.songs ?? null) ?? undefined;
  });

/** The Library's folders, where a download's file goes. */
interface DownloadFolders {
  readonly roots: readonly { readonly path: string; readonly isDefault: boolean }[];
  readonly excludedFolders: readonly string[];
}

/** Soulseek's search for [song]'s recording, its failure kept for the prepare answer. */
const searchSoulseek = (song: YtSong) => {
  const query = soulseekQuery(song);
  return Effect.result(
    query === ""
      ? Effect.fail(new DownloadFailed({ reason: "unavailable" }))
      : native(() => WaveSoulseek.search(query)),
  );
};

/**
 * A Soulseek job's prepare answer from its search ([found]): the peers with [song]'s recording,
 * or Soulseek's failure, with YouTube Music's fallback while YT Music is on ([ytMusicOn]) and
 * its M4A has a place. A job not named after a video falls back only to the video [youtube]
 * names; a song's fallback asks for its video when it starts (`prepare`).
 */
const soulseekAnswer = (
  song: YtSong,
  found: Result.Result<readonly SoulseekCandidate[], DownloadFailed>,
  tags: YtDownloadTags,
  { roots, excludedFolders }: DownloadFolders,
  ytMusicOn: boolean,
  youtube: Pick<DownloadFallbackPlan, "video" | "prepare">,
) =>
  Effect.gen(function* () {
    const m4a = ytMusicOn ? ytDownloadDestination(roots, excludedFolders, tags, "youtube") : null;
    // YouTube Music carries the job on only where its M4A has a place.
    const failurePlan = downloadFailurePlan("soulseek", { ytMusicOn: m4a !== null });
    const fallback: { readonly fallback?: DownloadFallbackPlan } =
      m4a === null
        ? {}
        : {
            fallback: {
              source: "youtube",
              ...youtube,
              targetPath: m4a.path,
              failurePlan: downloadFailurePlan("youtube", { ytMusicOn }),
            },
          };
    if (Result.isFailure(found))
      return {
        failure: found.failure.reason,
        tags,
        failurePlan,
        ...fallback,
      } satisfies PrepareAnswer;
    const candidates = soulseekCandidates(song, found.success);
    if (candidates.length === 0)
      return { failure: "unavailable", tags, failurePlan, ...fallback } satisfies PrepareAnswer;
    const target = ytDownloadDestination(roots, excludedFolders, tags, "soulseek");
    if (target === null) return yield* new DownloadFailed({ reason: "noFolder" });
    return {
      source: "soulseek",
      candidates,
      tags,
      targetPath: target.path,
      failurePlan,
      ...fallback,
    } satisfies PrepareAnswer;
  });

/** A YT Music search's failure as a download's. */
const searchFailure = (error: YtMusicError): DownloadFailed =>
  new DownloadFailed({
    reason:
      error.reason === "offline" ? "offline" : error.reason === "disabled" ? "noSource" : "failed",
    cause: error,
  });

/**
 * The cover of the album YouTube Music files video [videoId] under, read as a YT Music song's
 * download reads its album (the watch page, then the album page); null when it has none, or
 * YouTube Music doesn't answer in time.
 */
const videoCover = (videoId: string) =>
  optional(
    Effect.gen(function* () {
      const { albumId } = yield* native(() => WaveYtDownloads.watchSong(videoId));
      return albumId === null ? null : (yield* native(() => readYtAlbum(albumId))).artworkUrl;
    }),
  );

/** [video] with its album's cover (`videoCover`) when it came without one: a missing song's own video. */
const withCover = (video: MissingSongVideo | null) =>
  video === null || video.artworkUrl !== null
    ? Effect.succeed(video)
    : videoCover(video.videoId).pipe(Effect.map((artworkUrl) => ({ ...video, artworkUrl })));

/**
 * The journal's "prepare" decision for missing song [trackId] (job `missing:<id>`), read from
 * its Track as it is now. Core picks the source: the video it was downloaded from, while YT
 * Music is on; else Soulseek's peers with the recording while Download in best quality is on,
 * falling back to YouTube Music's match; else that match (`missingSongVideo`). The file gets the
 * Track's tags and the video's cover (its own video's from its album page, `withCover`). Nothing matched on YouTube Music fails it as notFound, and the song stays missing.
 */
const prepareMissingSong = (trackId: number) =>
  Effect.gen(function* () {
    const store = yield* LibraryStore;
    const [roots, excludedFolders, tracks] = yield* Effect.all([
      store.listRoots,
      store.excludedFolders,
      store.missingSongs([trackId]),
    ]).pipe(Effect.mapError(libraryFailure));
    const track = tracks[0];
    // Gone, or filled in since (a scan found its file): there's nothing left to download.
    if (track === undefined) return yield* new DownloadFailed({ reason: "failed" });
    if (roots.length === 0) return yield* new DownloadFailed({ reason: "noFolder" });
    const job = missingSongJob(track);
    const ytMusicOn = ytMusicEnabled();
    const source = currentSource(
      yield* native(() => WaveSoulseek.session()),
      ytMusicOn,
      job.missing.videoId !== null,
    );
    if (source === null) return yield* new DownloadFailed({ reason: "noSource" });
    const ytMusic = yield* YtMusic;
    const search = missingSongSearch(job);
    const findVideo = !ytMusicOn
      ? Effect.succeed(null)
      : search === null
        ? withCover(missingSongVideo(job, null))
        : withSearchTurn("download", search, ytMusic.searchSongs(search)).pipe(
            Effect.map((page) => missingSongVideo(job, page.songs)),
            Effect.mapError(searchFailure),
          );
    const lookup = missingSongLookup(job);
    const findTags =
      lookup === null ? Effect.succeed(null) : optional(lookUpLyricsAndGenre(lookup));
    if (source === "youtube") {
      const [video, found] = yield* Effect.all([findVideo, findTags], { concurrency: "unbounded" });
      if (video === null) return yield* new DownloadFailed({ reason: "notFound" });
      const tags = missingSongTags(job, found, video.artworkUrl);
      const target = ytDownloadDestination(roots, excludedFolders, tags, source);
      if (target === null) return yield* new DownloadFailed({ reason: "noFolder" });
      return {
        source,
        video: video.videoId,
        candidates: [],
        tags,
        targetPath: target.path,
        failurePlan: downloadFailurePlan(source, { ytMusicOn }),
      } satisfies PrepareAnswer;
    }
    const [peers, video, found] = yield* Effect.all(
      [
        searchSoulseek(job),
        // Soulseek doesn't wait on YouTube Music: no match only leaves it no fallback.
        findVideo.pipe(Effect.orElseSucceed(() => null)),
        findTags,
      ],
      { concurrency: "unbounded" },
    );
    const tags = missingSongTags(job, found, video?.artworkUrl ?? null);
    return yield* soulseekAnswer(
      job,
      peers,
      tags,
      { roots, excludedFolders },
      ytMusicOn && video !== null,
      video === null ? {} : { video: video.videoId },
    );
  });

/**
 * The tags of a song downloaded without a YouTube Music video: what it keeps (an unsearched
 * song's, what Spotify listed), filled in from the lookup Fix Song uses (Deezer, LRCLIB), its
 * explicit flag Deezer's (Core's `listedSongTags`: the listing's own is a placeholder).
 * Nothing is asked of YouTube Music: it has no video to read an album page by.
 */
const listingTags = (song: YtSong) =>
  Effect.gen(function* () {
    const lookup = ytDownloadLookup(song, null);
    const found = lookup === null ? null : yield* optional(lookUpLyricsAndGenre(lookup));
    return listedSongTags(song, found);
  });

/**
 * Puts the YT Music song [found] for unsearched job [jobId] on that job (an alias), so the
 * playlist entry it settles into shows the job's progress and isn't asked for again; a song
 * another job already holds keeps that job.
 */
const shareUnsearchedJob = async (jobId: string, found: NativeYtSong): Promise<void> => {
  const jobs = await WaveSoulseek.jobsSnapshot();
  const held = jobs.some(
    (job) =>
      job.id === found.videoId || job.aliases?.some((alias) => alias.videoId === found.videoId),
  );
  if (!held) await WaveSoulseek.enqueueJob(found, soulseekRecording(found), jobId, null, null);
  await refresh();
};

/**
 * The YouTube Music video unsearched song [song] (job [jobId]) downloads: one Songs search for
 * it, with downloads' turn in the search allowance, settles it as playing's does (Core's
 * `settleUnsearched`, the app's `settleUnsearchedSong`), and Core's `unsearchedDownload` says
 * what the download does with it. Found, the video is the search's result, the song's audio
 * track, so no second search is made; it comes with the song to tag it as. Not found (the entry
 * is unavailable now) or a failed search (it stays unsearched) fails the download.
 */
const unsearchedVideo = (jobId: string, song: UnsearchedSong) =>
  Effect.gen(function* () {
    const ytMusic = yield* YtMusic;
    const query = unsearchedSearchQuery(song);
    const answer = yield* withSearchTurn("download", query, ytMusic.searchSongs(query)).pipe(
      Effect.map((page): YtSongSearch<YtAlbumSong> => ({ ok: true, songs: page.songs })),
      Effect.catch((error) =>
        Effect.succeed<YtSongSearch<YtAlbumSong>>({ ok: false, reason: error.reason }),
      ),
    );
    const step = unsearchedDownload(song, settleUnsearched(song, answer));
    // The job takes the song found before the entry becomes it, so it's never asked for twice.
    if (step.kind === "download") yield* native(() => shareUnsearchedJob(jobId, step.found));
    yield* Effect.tryPromise({
      try: () => settleUnsearchedSong(song, answer),
      catch: libraryFailure,
    });
    if (step.kind === "fail") return yield* new DownloadFailed({ reason: step.failure });
    return { video: step.video, song: step.song };
  });

/**
 * The journal's "prepare" decision for unsearched song [song] (job [claim]), which has no video:
 * Core picks the source as for a song without one. From YouTube Music, its search settles it
 * and names the video (`unsearchedVideo`), tagged as a YT Music song's download is, with what
 * the entry kept. From Soulseek, by its title and artists, tagged from what the entry kept and
 * the lookup, with no YouTube Music search; YouTube Music's fallback searches it only once
 * Soulseek can't deliver (`prepareFallback`).
 */
const prepareUnsearchedSong = (claim: NativeDownloadDecision, song: UnsearchedSong) =>
  Effect.gen(function* () {
    const store = yield* LibraryStore;
    const [roots, excludedFolders] = yield* Effect.all([
      store.listRoots,
      store.excludedFolders,
    ]).pipe(Effect.mapError(libraryFailure));
    if (roots.length === 0) return yield* new DownloadFailed({ reason: "noFolder" });
    const ytMusicOn = ytMusicEnabled();
    const source = currentSource(yield* native(() => WaveSoulseek.session()), ytMusicOn);
    if (source === null) return yield* new DownloadFailed({ reason: "noSource" });
    if (source === "youtube") {
      const found = yield* unsearchedVideo(claim.id, song);
      const tags = yield* metadata(found.song);
      const target = ytDownloadDestination(roots, excludedFolders, tags, source);
      if (target === null) return yield* new DownloadFailed({ reason: "noFolder" });
      return {
        source,
        video: found.video,
        candidates: [],
        tags,
        targetPath: target.path,
        failurePlan: downloadFailurePlan(source, { ytMusicOn }),
      } satisfies PrepareAnswer;
    }
    const [peers, tags] = yield* Effect.all([searchSoulseek(claim.song), listingTags(claim.song)], {
      concurrency: "unbounded",
    });
    return yield* soulseekAnswer(claim.song, peers, tags, { roots, excludedFolders }, ytMusicOn, {
      prepare: true,
    });
  });

/** A file's lyrics as the Lyrics view reads them; none when they can't be read. */
const fileLyrics = (path: string) =>
  Effect.tryPromise(() => WaveNative.readLyrics(path)).pipe(
    Effect.orElseSucceed(() => ({ embedded: null, sidecar: null })),
  );

/**
 * The journal's "prepare" decision for a quality replacement of Track [trackId] (job
 * `upgrade:<id>`, Core's `downloadJobKind`), read from the Track as it is now. An upgrade is
 * Soulseek's MP3 320 or nothing: it never falls back to YouTube Music, and no 320 copy fails it as
 * Core's `NO_BETTER_COPY_FOUND`, which records the song as having no better copy
 * (`noBetterCopies`) without listing it as a failed download. The new file goes beside the old one
 * under its name, with the old one's tags, cover and lyrics (`qualityReplacementTarget`,
 * `qualityReplacementTags`). A Track gone meanwhile has nothing left to replace: it settles the
 * same way (there's no Track left to record). Freeing space is YouTube Music's copy
 * (`prepareQualityDowngrade`).
 */
const prepareQualityReplacement = (direction: QualityDirection, trackId: number) =>
  Effect.gen(function* () {
    const store = yield* LibraryStore;
    const track = yield* store.replacedTrack(trackId).pipe(Effect.mapError(libraryFailure));
    if (track === null) return yield* new DownloadFailed({ reason: NO_BETTER_COPY_FOUND });
    if (direction === "downgrade") return yield* prepareQualityDowngrade(track);
    const session = yield* native(() => WaveSoulseek.session());
    if (session.status === "off") return yield* new DownloadFailed({ reason: "noSource" });
    const job = qualityReplacementJob(direction, track);
    const [found, lyrics] = yield* Effect.all([searchSoulseek(job), fileLyrics(track.path)], {
      concurrency: "unbounded",
    });
    const tags = qualityReplacementTags(track, lyrics);
    const failurePlan = downloadFailurePlan("soulseek", { ytMusicOn: false });
    if (Result.isFailure(found))
      return { failure: found.failure.reason, tags, failurePlan } satisfies PrepareAnswer;
    const candidates = soulseekCandidates(job, found.success);
    if (candidates.length === 0)
      return { failure: NO_BETTER_COPY_FOUND, tags, failurePlan } satisfies PrepareAnswer;
    return {
      source: "soulseek",
      candidates,
      tags,
      targetPath: qualityReplacementTarget(track.path, "soulseek").targetPath,
      failurePlan,
    } satisfies PrepareAnswer;
  });

/**
 * `prepareQualityReplacement` freeing space for [track] (job `downgrade:<id>`): YouTube Music's
 * copy, found as a listing's song is (a Songs search for its title and artists, matched by
 * title, artists and length: Core's `qualityDowngradeSearch`, `qualityDowngradeVideo`) and
 * downloaded as the usual M4A beside the MP3, with its tags, cover and lyrics. No match fails it
 * as Core's `NO_BETTER_COPY_FOUND`: the song keeps its MP3 and isn't offered again. YT Music
 * turned off since has no source, which isn't the song's.
 */
const prepareQualityDowngrade = (track: ReplacedTrack) =>
  Effect.gen(function* () {
    if (!ytMusicEnabled()) return yield* new DownloadFailed({ reason: "noSource" });
    const ytMusic = yield* YtMusic;
    const job = qualityReplacementJob("downgrade", track);
    const query = qualityDowngradeSearch(job);
    const [page, lyrics] = yield* Effect.all(
      [
        withSearchTurn("download", query, ytMusic.searchSongs(query)).pipe(
          Effect.mapError(searchFailure),
        ),
        fileLyrics(track.path),
      ],
      { concurrency: "unbounded" },
    );
    const video = qualityDowngradeVideo(job, page.songs);
    if (video === null) return yield* new DownloadFailed({ reason: NO_BETTER_COPY_FOUND });
    return {
      source: "youtube",
      video,
      candidates: [],
      tags: qualityReplacementTags(track, lyrics),
      targetPath: qualityReplacementTarget(track.path, "youtube").targetPath,
      failurePlan: downloadFailurePlan("youtube", { ytMusicOn: true }),
    } satisfies PrepareAnswer;
  });

/** Recheck current folders both before publication and before recovered completion import. */
export const downloadPathIncluded = (path: string) =>
  Effect.gen(function* () {
    const store = yield* LibraryStore;
    const [roots, excluded] = yield* Effect.all([store.listRoots, store.excludedFolders]).pipe(
      Effect.mapError(libraryFailure),
    );
    return (
      roots.some((root) => isWithin(path, root.path)) &&
      !excluded.some((folder) => isWithin(path, folder))
    );
  });

/**
 * Downloads landed so far this process. A landing reaches `libraryVersion` only with the run's
 * others (`songsLanded`), so what reads the Library to reconcile downloads follows both
 * (`downloadLibraryVersion`).
 */
let landedCount = 0;

/**
 * The Tracks each imported file (by path) landed, until its fill-in is done (`answerJob`): they
 * wait for it, so the song and its fill-in reach the lists as one change (`songsFilledIn`).
 */
const awaitingFillIn = new Map<string, readonly number[]>();

const countAndLand = (path: string, trackIds: readonly number[], last: boolean): void => {
  landedCount++;
  awaitingFillIn.set(path, trackIds);
  songsLanded(trackIds, { last, fillIn: true });
};

/** The Library as downloads' reconciliation knows it: every edit and every landing changes it. */
const downloadLibraryVersion = (): string => `${libraryVersion.get()}:${landedCount}`;

/**
 * Transactional upsert preserves ids, favorites, playlists and history on
 * repeated delivery. A song downloaded from YouTube Music keeps its
 * [videoId] on its Track; a Soulseek download has none. A missing song's
 * download fills in its Track ([fills]), so its places, star and plays stay.
 * Any download of a liked song a pending favorite waits for stars it
 * (`saveBatch` settles it). The song lands with the run's others
 * (`songsLanded`), at once when it's the run's [last].
 */
export const importDownload = (
  saved: NativeSavedDownload,
  videoId: string | null,
  fills: number | null = null,
  last = false,
) =>
  Effect.gen(function* () {
    if (!(yield* downloadPathIncluded(saved.path)))
      return yield* new DownloadFailed({ reason: "noFolder" });
    const store = yield* LibraryStore;
    const { starred, trackIds } = yield* store
      .saveBatch(
        [{ ...toIndexedTrack(saved.track), videoId, ...(fills === null ? {} : { fills }) }],
        saved.artwork === null ? [] : [toIndexedArtwork(saved.artwork)],
      )
      .pipe(Effect.mapError(libraryFailure));
    countAndLand(saved.path, trackIds, last);
    // A liked song a pending favorite was waiting for has its star.
    publishSavedStars(starred);
    return saved.path;
  });

/**
 * A quality replacement's file takes over Track [trackId] in place (the store's
 * `replaceTrackFile`): the same Track id, favorites, plays, playlist entries and recording key.
 * Only then is the old file deleted (recorded with the swap: `finishFileDeletions`), unless the
 * new one took its very path. A Track removed
 * meanwhile takes its new file with it. YouTube Music's copy carries its [videoId]. The Track
 * lands as an import does (`songsLanded`).
 */
export const importQualityReplacement = (
  saved: NativeSavedDownload,
  trackId: number,
  videoId: string | null = null,
  last = false,
) =>
  Effect.gen(function* () {
    if (!(yield* downloadPathIncluded(saved.path)))
      return yield* new DownloadFailed({ reason: "noFolder" });
    const store = yield* LibraryStore;
    const replaced = yield* store
      .replaceTrackFile(
        trackId,
        { ...toIndexedTrack(saved.track), ...(videoId === null ? {} : { videoId }) },
        saved.artwork === null ? [] : [toIndexedArtwork(saved.artwork)],
      )
      .pipe(Effect.mapError(libraryFailure));
    // The swap recorded the old file's deletion (or the new file's, the Track gone): finished
    // now, and by the next launch if Wave dies first. A replayed import whose Track already has
    // the new file finds the old one still recorded. The media scanner sees the old file go with
    // the new one, once its fill-in is done (`fillInLyricsAndGenre`). Only other runs' leftovers
    // it finishes get a line: its own deletion is the usual end of a replacement.
    yield* finishFileDeletions("import", {
      scanWith: saved.path,
      own: replaced.kind === "replaced" ? replaced.oldPath : saved.path,
    });
    countAndLand(saved.path, replaced.kind === "gone" ? [] : [trackId], last);
    if (replaced.kind === "replaced") publishSavedStars(replaced.starred);
    return saved.path;
  });

const downloads = makeExternalStore<YtDownloads<NativeYtSong>>(YT_DOWNLOADS_NONE);

/** Re-reads folder policy so a publication never lands outside the current Library folders. */
const publicationTarget = (claim: NativeDownloadDecision) =>
  Effect.gen(function* () {
    const { roots, excludedFolders, revision } = yield* refreshDownloadPolicy;
    const replacement = downloadJobKind(claim.id);
    if (replacement.kind === "quality") {
      // Beside the file it replaces, as it is now (a scan may have moved it), or over it.
      const store = yield* LibraryStore;
      const track = yield* store
        .replacedTrack(replacement.trackId)
        .pipe(Effect.mapError(libraryFailure));
      if (track === null) return yield* new DownloadFailed({ reason: NO_BETTER_COPY_FOUND });
      const { targetPath, replaces } = qualityReplacementTarget(
        track.path,
        claim.source ?? "soulseek",
      );
      return { targetPath, revision, ...(replaces === null ? {} : { replaces }) };
    }
    if (claim.tags === undefined) return yield* new DownloadFailed({ reason: "failed" });
    // The same kind of file the job is downloading: a job from before sources is Soulseek's.
    const target = ytDownloadDestination(
      roots,
      excludedFolders,
      claim.tags,
      claim.source ?? "soulseek",
    );
    if (target === null) return yield* new DownloadFailed({ reason: "noFolder" });
    return { targetPath: target.path, revision };
  });

/** What the log says about [claim]'s YouTube download once its [audio] is checked (Core's `ytDownloadReport`). */
const youtubeReport = (claim: NativeDownloadDecision, audio: NativeYoutubeAudio): string => {
  // A missing song's job has no video of its own: its length is its Track's, as a quality
  // replacement's is. Nor has an unsearched song's: its length is what Spotify listed.
  const { kind } = downloadJobKind(claim.id);
  const missing = kind === "missing" || kind === "quality";
  const unsearched = kind === "unsearched";
  return ytDownloadReport({
    song: missing || unsearched ? null : claim.song.videoId,
    requested: audio.requested ?? claim.video ?? claim.song.videoId,
    resolved: audio.resolved ?? null,
    client: audio.client ?? null,
    videoType: audio.videoType ?? null,
    announcedMs: audio.announcedMs ?? null,
    expectedMs: claim.song.durationMs,
    expectedFrom: missing ? "library" : unsearched ? "spotify" : "ytMusic",
    measuredMs: audio.durationMs,
  });
};

/**
 * Drops the lyrics the Lyrics view saved for [claim]'s song, by its own video and the one its
 * download named, once its file is in the Library. Never fails: a copy left over is harmless.
 */
const forgetLyricsSavedFor = (claim: NativeDownloadDecision) =>
  Effect.gen(function* () {
    const store = yield* LibraryStore;
    const videoIds = [...new Set([claim.song.videoId, claim.video ?? claim.song.videoId])];
    yield* store.forgetSavedLyrics(videoIds);
  }).pipe(Effect.ignore);

/** The answer to one decision the native journal leased to JS. */
const answer = (claim: NativeDownloadDecision) =>
  Effect.gen(function* () {
    switch (claim.decision) {
      case "prepare": {
        // Soulseek handed the job over to YouTube Music, whose turn starts here.
        if (claim.fellBackFrom !== undefined && claim.source === "youtube")
          return yield* prepareFallback(claim);
        const job = downloadJobKind(claim.id);
        if (job.kind === "missing") return yield* prepareMissingSong(job.trackId);
        if (job.kind === "quality")
          return yield* prepareQualityReplacement(job.direction, job.trackId);
        const unsearched = unsearchedJobSong(claim.id, claim.song);
        return unsearched === null
          ? yield* prepareDownload(claim.song)
          : yield* prepareUnsearchedSong(claim, unsearched);
      }
      case "confirm": {
        if (claim.audio === undefined) return yield* new DownloadFailed({ reason: "failed" });
        if (!("receivedTags" in claim.audio)) {
          // YouTube's M4A arrived complete; it's the song when it plays as long.
          // A rejection says so as its cause, which the failed download's row shows.
          const { durationMs } = claim.audio;
          const rejection = ytAudioRejection(claim.song, durationMs);
          appLog(
            rejection === null ? "info" : "warn",
            "downloads",
            youtubeReport(claim, claim.audio),
          );
          if (rejection === null) return { receiptId: claim.receiptId, acceptable: true };
          return { receiptId: claim.receiptId, acceptable: false, cause: rejection };
        }
        const { receivedTags, durationMs } = claim.audio;
        const acceptable = soulseekReceivedMatches(claim.song, receivedTags, durationMs);
        if (!acceptable)
          console.warn("[wave] a received file isn't the recording", { receivedTags, durationMs });
        return { receiptId: claim.receiptId, acceptable };
      }
      case "publish":
        return yield* publicationTarget(claim);
      case "import": {
        if (claim.saved === undefined) return yield* new DownloadFailed({ reason: "failed" });
        yield* refreshDownloadPolicy;
        // A quality replacement's file takes over its Track in place; YouTube Music's copy
        // gives it the video it came from, as any YouTube download has.
        const job = downloadJobKind(claim.id);
        const last = lastOfRun(claim.id);
        if (job.kind === "quality") {
          const video = claim.source === "youtube" ? (claim.video ?? null) : null;
          return { path: yield* importQualityReplacement(claim.saved, job.trackId, video, last) };
        }
        // A missing song's job is named after its Track, an unsearched song's after what Spotify
        // listed: their video is the one prepare named.
        const fills = job.kind === "missing" ? job.trackId : null;
        const ownVideo = job.kind === "song";
        // A job from before YouTube Music downloads is Soulseek's.
        const videoId =
          claim.source !== "youtube"
            ? null
            : (claim.video ?? (ownVideo ? claim.song.videoId : null));
        const path = yield* importDownload(claim.saved, videoId, fills, last);
        // The file carries the song's lyrics now: what the Lyrics view saved for it isn't needed.
        yield* forgetLyricsSavedFor(claim);
        return { path };
      }
    }
  }).pipe(
    Effect.catchCause((cause) => {
      // An interrupted answer isn't one: the lease expires and the journal asks again.
      if (Cause.hasInterruptsOnly(cause)) return Effect.failCause(cause);
      // Anything unexpected (a defect too) fails as itself, never as storage, and says what it was.
      const error = Cause.squash(cause);
      const decided = error instanceof DownloadFailed;
      if (!decided) console.warn(`[wave] the ${claim.decision} decision failed`, error);
      return Effect.succeed(
        downloadFailureAnswer(
          claim.decision,
          decided ? error.reason : "failed",
          decided ? error.cause : error,
          {
            // A job's first prepare holds no plan yet: it gets its source's, to try again by.
            failurePlan:
              claim.failurePlan ??
              downloadFailurePlan(claim.source ?? "soulseek", { ytMusicOn: ytMusicEnabled() }),
            fallback: claim.fallback,
            tags: claim.tags,
          },
        ),
      );
    }),
  );

/** A download as Fix Song sees it: what its file says once tagged and saved. */
const downloadedSong = ({ path, track }: NativeSavedDownload) => {
  // The track number, year and explicit flag as the index reads them ("3/12" is 3).
  const { trackNumber, year, explicit } = toIndexedTrack(track);
  return {
    path,
    title: track.title ?? "",
    artist: track.artist ?? "",
    album: track.album ?? "",
    durationMs: track.durationMs,
    hasLyrics: track.hasLyrics,
    genre: track.genre,
    trackNumber,
    year,
    explicit,
  };
};

/**
 * How often a decision still being worked on renews its lease: well inside the journal's 45 s,
 * so a prepare waiting for the YouTube Music search allowance keeps it.
 */
const RENEW_EVERY_MS = 20_000;

const answering = new Set<string>();
/**
 * Claims and answers [id]'s pending decision, renewing its lease while the answer is worked
 * out; an unanswered lease (JS gone) expires natively and is offered again.
 */
const answerJob = async (id: string): Promise<void> => {
  if (answering.has(id)) return;
  answering.add(id);
  let renewing: ReturnType<typeof setInterval> | undefined;
  try {
    const claim = await WaveSoulseek.claimDecision(id);
    if (claim === null) return;
    renewing = setInterval(() => {
      WaveSoulseek.renewDecision(claim.id, claim.generation, claim.token).catch(() => {});
    }, RENEW_EVERY_MS);
    const payload = await appRuntime.runPromise(answer(claim));
    clearInterval(renewing);
    const accepted = await WaveSoulseek.submitDecision(
      claim.id,
      claim.generation,
      claim.token,
      claim.decision,
      JSON.stringify(payload),
    );
    if (claim.decision === "import" && claim.saved !== undefined) {
      const { path } = claim.saved;
      const landedIds = awaitingFillIn.get(path) ?? [];
      awaitingFillIn.delete(path);
      if (accepted && "path" in payload)
        void appRuntime.runPromise(
          fillInLyricsAndGenre(
            downloadedSong(claim.saved),
            downloadTagWriteOrigin(claim.id),
            landedIds,
          ),
        );
      // No fill-in follows: the song goes with its run's change now.
      else songsFilledIn(landedIds, { wrote: false });
    }
  } catch {
    // JS or the bridge went away mid-answer: the native lease expires and replays the decision.
  } finally {
    clearInterval(renewing);
    answering.delete(id);
  }
};

const awaitsAnswer = (job: NativeDownloadJob): boolean =>
  job.phase === "preparing" ||
  job.phase === "sourceReady" ||
  job.phase === "awaitingPublication" ||
  (job.phase === "completed" && job.acknowledged !== true && job.importFailure === undefined);

/** Still on its way: a failure, a cancel or an import ends it. */
const unfinished = (job: NativeDownloadJob): boolean =>
  job.phase !== "failed" &&
  job.phase !== "cancelled" &&
  job.acknowledged !== true &&
  job.importFailure === undefined;

/** Whether job [id], being imported, is the last of its run: nothing else is on its way. */
const lastOfRun = (id: string): boolean =>
  followed.every((job) => job.id === id || !unfinished(job));

/**
 * The journal as JS follows it, and the journal revision that is at: each refresh asks only for
 * what changed since (Core's `applyJournalChanges`), so a big queue isn't copied over the bridge
 * and compared whole for every bit of progress.
 */
let followed: readonly NativeDownloadJob[] = [];
let followedRevision = 0;
/** The jobs rows were last given; an unchanged journal keeps the same list and doesn't re-render them. */
let shown: readonly NativeDownloadJob[] | null = null;
/** A slow re-read while downloads are unfinished, in case an event was missed. */
let poll: ReturnType<typeof setInterval> | null = null;

let refreshing = false;
let refreshAgain = false;
/** Read once per Library version (`downloadLibraryVersion`), including when downloads land between edits. */
let downloadLibrary: { readonly version: string; readonly songs: readonly SongRow[] } | null = null;
/** Progress on unfinished jobs doesn't change which finished jobs the Library still has. */
let reconciledDownloads = "";

/** Core's finished jobs to forget, decided against a Library read after their journal snapshot. */
const forgetDeletedDownloads = async (
  jobs: readonly NativeDownloadJob[],
): Promise<readonly NativeDownloadJob[]> => {
  if (!jobs.some((job) => job.phase === "completed" && job.acknowledged === true)) return jobs;
  const version = downloadLibraryVersion();
  const revision = JSON.stringify([
    version,
    jobs
      .filter((job) => job.phase === "completed" && job.acknowledged === true)
      .map((job) => [job.id, job.generation]),
  ]);
  if (revision === reconciledDownloads) return jobs;
  if (downloadLibrary?.version !== version) {
    const songs = await appRuntime.runPromise(
      Effect.gen(function* () {
        const store = yield* LibraryStore;
        return yield* store.listSongs;
      }),
    );
    // A scan or import landed while the read was pending. Re-read both snapshots before deciding.
    if (version !== downloadLibraryVersion()) {
      refreshAgain = true;
      return jobs;
    }
    downloadLibrary = { version, songs };
  }
  const forgotten = new Set<string>();
  for (const id of ytDownloadsToForget(jobs, downloadLibrary.songs)) {
    if (version !== downloadLibraryVersion()) {
      refreshAgain = true;
      break;
    }
    const job = jobs.find((candidate) => candidate.id === id);
    if (job !== undefined && (await WaveSoulseek.forgetCompletedJob(id, job.generation)))
      forgotten.add(id);
  }
  if (version === downloadLibraryVersion()) reconciledDownloads = revision;
  return forgotten.size === 0 ? jobs : jobs.filter((job) => !forgotten.has(job.id));
};

/** The replacement jobs (Core's `qualityJobId`) already recorded as having no better copy this launch. */
const recordedNoBetterCopyJobs = new Set<string>();
const noBetterCopyListeners = new Set<() => void>();
/**
 * The writes recording them, in order, each saying whether it was written: settled replacements
 * are forgotten only after, and only when it was.
 */
let recordingNoBetterCopies = Promise.resolve(true);

/**
 * Records the songs the journal's replacements found no better copy of (Core's
 * `noBetterCopies`), each once a launch: they keep their files and aren't offered again.
 * Resolves to whether the latest write went through. One that fails is tried again at the next
 * refresh, the journal keeping the failure meanwhile (`forgetSettledFailures` leaves it).
 */
const rememberNoBetterCopies = (jobs: readonly NativeDownloadJob[]): Promise<boolean> => {
  const fresh = noBetterCopies(jobs).filter(
    (song) => !recordedNoBetterCopyJobs.has(qualityJobId(song.direction, song.trackId)),
  );
  if (fresh.length === 0) return recordingNoBetterCopies;
  for (const song of fresh)
    recordedNoBetterCopyJobs.add(qualityJobId(song.direction, song.trackId));
  recordingNoBetterCopies = recordingNoBetterCopies
    .then(() =>
      appRuntime.runPromise(
        Effect.gen(function* () {
          const store = yield* LibraryStore;
          yield* store.rememberNoBetterCopies(fresh);
        }),
      ),
    )
    .then(
      () => {
        for (const listener of noBetterCopyListeners) listener();
        return true;
      },
      () => {
        for (const song of fresh)
          recordedNoBetterCopyJobs.delete(qualityJobId(song.direction, song.trackId));
        return false;
      },
    );
  return recordingNoBetterCopies;
};

/** The failed replacements' new files already recorded for deletion this launch. */
const removedReplacementFiles = new Set<string>();

/**
 * Removes the new files failed replacements left in the Library's folders (Core's
 * `failedReplacementFiles`), each once a launch: the song keeps its old file, and a scan
 * mustn't make the new one a second song. Recorded first (a file a Track holds is never
 * deleted), then deleted; a Retry downloads the song again.
 */
const removeFailedReplacementFiles = (jobs: readonly NativeDownloadJob[]): void => {
  const fresh = failedReplacementFiles(jobs).filter((path) => !removedReplacementFiles.has(path));
  if (fresh.length === 0) return;
  for (const path of fresh) removedReplacementFiles.add(path);
  void appRuntime
    .runPromise(
      Effect.gen(function* () {
        const store = yield* LibraryStore;
        yield* store.recordFileDeletions(fresh);
        yield* finishFileDeletions("failedReplacement");
      }),
    )
    .catch(() => {
      for (const path of fresh) removedReplacementFiles.delete(path);
    });
};

/** Calls [listener] once songs were recorded as having no better copy; returns how to stop. */
export const onNoBetterCopies = (listener: () => void): (() => void) => {
  noBetterCopyListeners.add(listener);
  return () => noBetterCopyListeners.delete(listener);
};

/** Mirrors the journal into the rows and answers what it waits on; coalesces overlapping calls. */
const refresh = async (): Promise<void> => {
  if (refreshing) {
    refreshAgain = true;
    return;
  }
  refreshing = true;
  try {
    do {
      refreshAgain = false;
      const changes = await WaveSoulseek.jobsChangedSince(followedRevision);
      const snapshotJobs = applyJournalChanges(followed, changes);
      followed = snapshotJobs;
      followedRevision = changes.revision;
      // YouTube refusing songs in a burst pauses its downloads (Core's `ytThrottle`).
      void followYoutubeThrottle(snapshotJobs);
      // A failed Library read keeps the journal intact and mustn't hide new progress or decisions.
      const jobs = await forgetDeletedDownloads(snapshotJobs).catch(() => snapshotJobs);
      if (jobs !== shown) {
        shown = jobs;
        downloads.set(ytDownloadsFromJournal(jobs));
        journal.set(jobs);
      }
      for (const job of jobs) if (awaitsAnswer(job)) void answerJob(job.id);
      void rememberNoBetterCopies(jobs);
      removeFailedReplacementFiles(jobs);
      replacementJournalRead(jobs);
      const active = jobs.some(unfinished);
      // The run is over (its last songs answered in one poll, or it ended in a failure or a
      // cancel): what landed reaches the lists now, with any fill-in still on its way.
      if (!active) songsLanded([], { last: true });
      if (active && poll === null) poll = setInterval(refreshQuietly, 5_000);
      if (!active && poll !== null) {
        clearInterval(poll);
        poll = null;
      }
    } while (refreshAgain);
  } finally {
    refreshing = false;
  }
};
const refreshQuietly = (): void => {
  void refresh().catch(() => undefined);
};

/** A failure Settings › Downloads lists until it settles: the download's, or the import's. */
const hasFailed = (job: NativeDownloadJob): boolean =>
  job.phase === "failed" || job.importFailure !== undefined;

let requests = Promise.resolve();

/**
 * The downloads only a star asked for, by job id (Core's `readStarDownloads`): unstarring the
 * song before its file arrives cancels them (`cancelUnstarredDownloads`). Kept on this phone,
 * so it survives Wave closing; the owner asking for one of them (`ownerAsked`) takes it out.
 */
const starAsked = persistedSetting<ReadonlySet<string>>({
  key: "downloads.starAsked",
  read: readStarDownloads,
  write: writeStarDownloads,
});

/**
 * The owner asked for the downloads [jobIds] themselves (Download, an album's, a playlist's,
 * Download All): they carry on whatever happens to the songs' stars. Run inside the request
 * that queues them, on the `requests` chain, so a star's request queued before it has claimed
 * its downloads by then, and none queued after it claims them back.
 */
const ownerAsked = (jobIds: readonly string[]): void =>
  starAsked.set(starAskedAfter(starAsked.get(), { kind: "ownerAsked", ids: jobIds }));

let forgotSettled = false;
/**
 * Has the journal forget the failures that settled another way since (Core's
 * `settledDownloadFailures`): Settings › Downloads no longer lists them, and the
 * journal would otherwise keep them, and rewrite them on every change, for good.
 * Once a launch, and only while some download has failed.
 */
const forgetSettledFailures = (): void => {
  if (forgotSettled) return;
  forgotSettled = true;
  requests = requests
    .then(async () => {
      const jobs = await WaveSoulseek.jobsSnapshot();
      if (!jobs.some(hasFailed)) return;
      // A replacement with no better copy settles here once what it found is recorded: while
      // that can't be written, the journal keeps it, so the song isn't offered again.
      const recorded = await rememberNoBetterCopies(jobs);
      const { songs, missing } = await appRuntime.runPromise(
        Effect.gen(function* () {
          const store = yield* LibraryStore;
          return { songs: yield* store.listSongs, missing: yield* store.missingSongs() };
        }),
      );
      const find = libraryFinder(songs);
      const settled = settledDownloadFailures(jobs, {
        inLibrary: (song) => find(song) !== null,
        missingTrackIds: new Set(missing.map((track) => track.id)),
      }).filter((id) => recorded || downloadJobKind(id).kind !== "quality");
      for (const videoId of settled) await WaveSoulseek.cancelJob(videoId);
      if (settled.length > 0) await refresh();
    })
    .catch(() => undefined);
};

/** Set on this phone once the songs YouTube's Oct 18 limit failed went back to the queue. */
const THROTTLED_REQUEUE_KEY = "downloads.throttledFailuresRequeued";

/**
 * Once an install, after the update that tells YouTube refusing a song from saying it's
 * unavailable: asks again for the songs that failed as unavailable at their first attempt and
 * were never tried again (Core's `throttledFailures`), as Retry would, so they follow the pause
 * and try-again rules, and logs how many. Waits for YT Music to be on; a read or a request that
 * fails leaves it for the next launch.
 */
const requeueThrottledFailures = (): void => {
  if (Storage.getItemSync(THROTTLED_REQUEUE_KEY) !== null || !ytMusicEnabled()) return;
  requests = requests
    .then(async () => {
      if (Storage.getItemSync(THROTTLED_REQUEUE_KEY) !== null) return;
      const jobs = await WaveSoulseek.jobsSnapshot();
      const session = await sessionNow();
      const library = await appRuntime.runPromise(
        Effect.gen(function* () {
          const store = yield* LibraryStore;
          return yield* Effect.all({
            songs: store.listSongs,
            missing: store.missingSongs(),
            files: store.qualityFiles,
            upgrade: store.noBetterCopies("upgrade"),
            downgrade: store.noBetterCopies("downgrade"),
          });
        }),
      );
      const find = libraryFinder(library.songs);
      const failed = throttledFailures(jobs, {
        inLibrary: (song) => find(song) !== null,
        missingTrackIds: new Set(library.missing.map((track) => track.id)),
        files: library.files,
        noBetterCopy: { upgrade: new Set(library.upgrade), downgrade: new Set(library.downgrade) },
        direction: qualityDirection(session.status !== "off"),
      });
      const asked = failed.length === 0 ? [] : await retryRequests(failed);
      if (asked.length > 0) await enqueueJobs(asked);
      Storage.setItemSync(THROTTLED_REQUEUE_KEY, String(Date.now()));
      appLog("info", "downloads", throttledFailuresLine(asked.length));
      if (asked.length > 0) await refresh();
    })
    .catch(() => undefined);
};

let attached = false;
/**
 * Follows the native journal. The app and the headless task (started by the
 * download service after process recreation) share this; the app also asks
 * the service to resume work the journal still holds, and has it forget the
 * failures that settled since.
 */
export const startDownloads = (resume = false): void => {
  if (!attached) {
    attached = true;
    followDownloadRuns();
    WaveSoulseek.addListener("onJobsChanged", refreshQuietly);
    libraryVersion.subscribe(refreshQuietly);
  }
  // Replays anything that changed before the listener was attached, e.g. while JS was starting.
  refreshQuietly();
  if (resume) {
    void WaveSoulseek.resumeJobs().catch(() => undefined);
    forgetSettledFailures();
    requeueThrottledFailures();
  }
};

/** A YT Music [song] asked for, to [enqueueJobs]. */
const songRequest = (
  song: NativeYtSong,
  equivalentId: string | null,
  source: DownloadSource | null,
  origin: DownloadOrigin | null,
): JobRequest => ({ song, recording: soulseekRecording(song), equivalentId, source, origin });

export const downloadYtSong = (song: NativeYtSong): void => {
  publishYtSongSignal("download", [song.videoId]);
  askForNotifications();
  startDownloads();
  // One at a time, so a second tap sees the first one's job in the journal.
  requests = requests
    .then(async () => {
      ownerAsked([song.videoId]);
      const shared = ytDownloadSharedJob(await WaveSoulseek.jobsSnapshot(), song);
      await WaveSoulseek.enqueueJob(
        song,
        soulseekRecording(song),
        shared,
        await requestedSource(),
        null,
      );
      await refresh();
    })
    .catch(() => undefined);
};

export const cancelYtDownload = (videoId: string): void => {
  void WaveSoulseek.cancelJob(videoId)
    .then(refresh)
    .catch(() => undefined);
};
export const useYtDownloadStatus = (videoId: string): YtDownloadStatus | null =>
  useSyncExternalStore(downloads.subscribe, () => ytDownloadStatus(downloads.get(), videoId));

/** Whether the Library already has a song (Core's `libraryFinder`). */
type InLibrary = (song: NativeYtSong) => boolean;

/**
 * Download Album / Download Playlist: every song of the list the Library
 * doesn't have joins the queue, in list order, sharing jobs already on their
 * way (Core's `ytSongsDownload`, decided on a fresh snapshot of the journal).
 * Each goes through the single-song pipeline, remembering [origin], the album or mix it's from.
 */
const downloadYtSongs = (
  songs: readonly NativeYtSong[],
  inLibrary: InLibrary,
  origin: DownloadOrigin | null,
): void => {
  publishYtSongSignal(
    "download",
    songs.map((song) => song.videoId),
  );
  askForNotifications();
  startDownloads();
  requests = requests
    .then(async () => {
      ownerAsked(songs.map((song) => song.videoId));
      const jobs = await WaveSoulseek.jobsSnapshot();
      const source = await requestedSource();
      await enqueueJobs(
        ytSongsDownload(songs, { inLibrary, jobs }).toDownload.map(({ song, sharedJob }) =>
          songRequest(song, sharedJob, source, origin),
        ),
      );
      await refresh();
    })
    .catch(() => undefined);
};

/**
 * Retry Failed: asks again for each of the list's songs whose download
 * failed, in list order, sharing jobs already on their way as Download does.
 */
const retryYtSongs = (
  songs: readonly NativeYtSong[],
  inLibrary: InLibrary,
  origin: DownloadOrigin | null,
): void => {
  askForNotifications();
  startDownloads();
  requests = requests
    .then(async () => {
      const jobs = await WaveSoulseek.jobsSnapshot();
      const source = await requestedSource();
      await enqueueJobs(
        ytSongsDownload(songs, { inLibrary, jobs }).toRetry.map(({ song, sharedJob }) =>
          songRequest(song, sharedJob, source, origin),
        ),
      );
      await refresh();
    })
    .catch(() => undefined);
};

/** Cancel Album / Playlist Download: the list's songs leave the jobs that aren't saving yet. */
const cancelYtSongs = (songs: readonly NativeYtSong[], inLibrary: InLibrary): void => {
  requests = requests
    .then(async () => {
      const jobs = await WaveSoulseek.jobsSnapshot();
      for (const videoId of ytSongsDownload(songs, { inLibrary, jobs }).toCancel)
        await WaveSoulseek.cancelJob(videoId);
      await refresh();
    })
    .catch(() => undefined);
};

/** An album's or a playlist's download entry (Core's `ytAlbumDownload`, `ytPlaylistDownload`). */
export type YtListDownloadAction = YtAlbumDownloadAction | YtPlaylistDownloadAction;

/**
 * Runs an album's or a playlist's download entry on its YT Music [songs]; the songs it queues
 * remember [origin], the album, playlist or mix they're from (Settings › Downloads groups them).
 */
export const runYtDownloadAction = (
  action: YtListDownloadAction,
  songs: readonly NativeYtSong[],
  inLibrary: InLibrary,
  origin: DownloadOrigin | null,
): void => {
  switch (action) {
    case "downloadAlbum":
    case "downloadPlaylist":
      downloadYtSongs(songs, inLibrary, origin);
      return;
    case "retryFailed":
      retryYtSongs(songs, inLibrary, origin);
      return;
    case "cancelAlbumDownload":
    case "cancelPlaylistDownload":
      cancelYtSongs(songs, inLibrary);
      return;
  }
};

/**
 * Where a YT Music album's download stands (Core's `ytAlbumDownload`), from
 * its [songs], the Library ([inLibrary]) and the journal, following both.
 */
export const useYtAlbumDownload = (
  songs: readonly NativeYtSong[],
  inLibrary: InLibrary,
): YtAlbumDownload<NativeYtSong> => {
  const jobs = useSyncExternalStore(journal.subscribe, journal.get);
  return useMemo(() => ytAlbumDownload(songs, { inLibrary, jobs }), [songs, inLibrary, jobs]);
};

/**
 * A playlist's entry: a Library song (its file), a YT Music song, an unsearched song, or an
 * unavailable song.
 */
type PlaylistEntry = PlaylistItem<NativeYtSong, { readonly path: string | null }>;

/**
 * Download Playlist, Retry Failed and Cancel Playlist Download on the playlist holding
 * [entries], decided on a fresh snapshot of the journal (Core's `ytPlaylistDownload`): its YT
 * Music and unsearched entries join the queue in playlist order, an unsearched one as the job
 * named after what Spotify listed, which searches it when it's prepared. Each goes through the
 * single-song pipeline, remembering [origin], the playlist.
 */
export const runYtPlaylistDownloadAction = (
  action: YtPlaylistDownloadAction,
  entries: readonly PlaylistEntry[],
  inLibrary: InLibrary,
  origin: DownloadOrigin | null,
): void => {
  if (action !== "cancelPlaylistDownload") {
    askForNotifications();
    startDownloads();
  }
  requests = requests
    .then(async () => {
      const jobs = await WaveSoulseek.jobsSnapshot();
      const download = ytPlaylistDownload(entries, { inLibrary, jobs });
      if (action === "cancelPlaylistDownload") {
        for (const videoId of download.toCancel) await WaveSoulseek.cancelJob(videoId);
      } else {
        const source = await requestedSource();
        const asked = action === "downloadPlaylist" ? download.toDownload : download.toRetry;
        await enqueueJobs(
          asked.map(({ song, sharedJob }) => songRequest(song, sharedJob, source, origin)),
        );
      }
      await refresh();
    })
    .catch(() => undefined);
};

/**
 * Where a playlist's download stands (Core's `ytPlaylistDownload`), from its
 * [entries], the Library ([inLibrary]) and the journal, following both.
 */
export const useYtPlaylistDownload = (
  entries: readonly PlaylistEntry[],
  inLibrary: InLibrary,
): YtPlaylistDownload<NativeYtSong> => {
  const jobs = useSyncExternalStore(journal.subscribe, journal.get);
  return useMemo(
    () => ytPlaylistDownload(entries, { inLibrary, jobs }),
    [entries, inLibrary, jobs],
  );
};

/**
 * What the journal holds of missing song [job]: a YT Music song named after its Track. Its
 * Track's tags stay in the Library, read again when the job is prepared.
 */
const journalSong = (job: MissingSongJob): NativeYtSong => ({
  videoId: job.videoId,
  title: job.title,
  artists: job.artists,
  album: job.album,
  durationMs: job.durationMs,
  artworkUrl: null,
  explicit: false,
  albumId: null,
});

/**
 * Asks the journal for missing song [job], from the source Core picks for it now, remembering
 * [origin] (a Library album's Download Missing Songs; none for a song on its own).
 */
const missingSongRequest = (
  job: MissingSongJob,
  session: SoulseekSession,
  ytMusicOn: boolean,
  origin: DownloadOrigin | null = null,
): JobRequest => ({
  song: journalSong(job),
  recording: soulseekRecording(job),
  equivalentId: null,
  source: currentSource(session, ytMusicOn, job.missing.videoId !== null),
  origin,
});

/** Asks the journal for missing songs [jobs], in order, each from the source Core picks for it. */
const enqueueMissingSongs = async (
  jobs: readonly MissingSongJob[],
  origin: DownloadOrigin | null = null,
): Promise<void> => {
  const session = await sessionNow();
  const ytMusicOn = ytMusicEnabled();
  await enqueueJobs(jobs.map((job) => missingSongRequest(job, session, ytMusicOn, origin)));
};

/** The missing songs as they are now ([trackIds] only, when given), as download jobs. */
const missingSongJobs = (trackIds?: readonly number[]): Promise<MissingSongJob[]> =>
  appRuntime
    // oxlint-disable-next-line react/rules-of-hooks -- Effect Service.use resolves a service; it is not a React Hook.
    .runPromise(LibraryStore.use((store) => store.missingSongs(trackIds)))
    .then((tracks) => tracks.map(missingSongJob));

/**
 * A missing song's Download (its tap or its menu entry) and Retry: asks for each of the songs
 * [trackIds] that is still missing. Its file fills in the same Track.
 */
export const downloadMissingSongs = (trackIds: readonly number[]): void => {
  askForNotifications();
  startDownloads();
  requests = requests
    .then(async () => {
      ownerAsked(trackIds.map(missingSongJobId));
      await enqueueMissingSongs(await missingSongJobs(trackIds));
      await refresh();
    })
    .catch(() => undefined);
};

/** A missing song's Cancel Download: it stays missing. */
export const cancelMissingSongDownload = (trackId: number): void =>
  cancelYtDownload(missingSongJobId(trackId));

/**
 * Where missing song [trackId]'s download stands, following the journal; null when not asked
 * for, or for no song ([trackId] null).
 */
export const useMissingSongDownloadStatus = (trackId: number | null): YtDownloadStatus | null =>
  useSyncExternalStore(downloads.subscribe, () =>
    trackId === null ? null : ytDownloadStatus(downloads.get(), missingSongJobId(trackId)),
  );

/**
 * Where the downloads of missing songs [trackIds] stand, each null when not asked for,
 * following the journal.
 */
export const useMissingSongDownloadStatuses = (
  trackIds: readonly number[],
): readonly (YtDownloadStatus | null)[] => {
  const state = useSyncExternalStore(downloads.subscribe, downloads.get);
  return useMemo(
    () => trackIds.map((id) => ytDownloadStatus(state, missingSongJobId(id))),
    [state, trackIds],
  );
};

/** [jobs] in the order of [trackIds], the Tracks they fill in. */
const inOrder = (
  jobs: readonly MissingSongJob[],
  trackIds: readonly number[],
): MissingSongJob[] => {
  const place = new Map(trackIds.map((id, index) => [id, index]));
  // oxlint-disable-next-line unicorn/no-array-sort -- sorts a fresh array; Hermes lacks toSorted
  return [...jobs].sort(
    (a, b) => (place.get(a.missing.trackId) ?? 0) - (place.get(b.missing.trackId) ?? 0),
  );
};

/**
 * Settings › Wave Account's Download All, Retry Failed and Cancel, decided on the missing songs
 * and the journal as they are now (Core's `missingSongsDownload`). With [trackIds] (an album's
 * Download Missing Songs, Retry Failed and Cancel Download), only those songs, in that order,
 * and the songs it queues remember [origin], the album.
 */
export const runMissingSongsDownloadAction = (
  action: MissingSongsDownloadAction,
  trackIds?: readonly number[],
  origin: DownloadOrigin | null = null,
): void => {
  if (action !== "cancel") {
    askForNotifications();
    startDownloads();
  }
  requests = requests
    .then(async () => {
      const [found, jobs] = await Promise.all([
        missingSongJobs(trackIds),
        WaveSoulseek.jobsSnapshot(),
      ]);
      const missing = trackIds === undefined ? found : inOrder(found, trackIds);
      const download = missingSongsDownload(missing, jobs);
      if (action === "downloadAll") ownerAsked(missing.map((job) => job.videoId));
      switch (action) {
        case "downloadAll":
          await enqueueMissingSongs(download.toDownload, origin);
          break;
        case "retryFailed":
          await enqueueMissingSongs(download.toRetry, origin);
          break;
        case "cancel":
          for (const id of download.toCancel) await WaveSoulseek.cancelJob(id);
          break;
      }
      await refresh();
    })
    .catch(() => undefined);
};

/**
 * Asks the journal to replace the Library songs [trackIds] in [direction], in order, each as
 * its own job (`upgrade:<id>`, Core's `qualityReplacementJob`) waiting under the run's group
 * (Core's `QUALITY_ORIGINS`). An upgrade comes from Soulseek, freeing space from YouTube Music. A
 * song gone meanwhile is skipped.
 */
const enqueueQualityReplacements = async (
  direction: QualityDirection,
  trackIds: readonly number[],
): Promise<void> => {
  await enqueueJobs(await qualityReplacementRequests(direction, trackIds));
};

/** What [enqueueQualityReplacements] asks the journal for. */
const qualityReplacementRequests = async (
  direction: QualityDirection,
  trackIds: readonly number[],
): Promise<JobRequest[]> => {
  const tracks = await appRuntime.runPromise(
    Effect.gen(function* () {
      // An earlier run's old files still recorded go first.
      yield* finishFileDeletions("replacementRun");
      const store = yield* LibraryStore;
      return yield* Effect.forEach(trackIds, (id) => store.replacedTrack(id));
    }),
  );
  const source: DownloadSource = direction === "upgrade" ? "soulseek" : "youtube";
  return tracks.flatMap((track) => {
    if (track === null) return [];
    const job = qualityReplacementJob(direction, track);
    return [
      {
        song: { ...job, albumId: null },
        recording: soulseekRecording(job),
        equivalentId: null,
        source,
        origin: QUALITY_ORIGINS[direction],
      },
    ];
  });
};

/**
 * A quality replacement run's Replace: the songs [trackIds] (Core's `QualityOffer.trackIds`)
 * join the download queue under its group, in order.
 */
export const runQualityReplacements = (
  direction: QualityDirection,
  trackIds: readonly number[],
): void => {
  if (trackIds.length === 0) return;
  askForNotifications();
  startDownloads();
  requests = requests
    .then(async () => {
      await enqueueQualityReplacements(direction, trackIds);
      await refresh();
    })
    .catch(() => undefined);
};

/**
 * Turning the switch back: the replacements in [direction] still waiting or downloading are
 * cancelled (Core's `qualityJobsToCancel`); one already saving finishes.
 */
export const cancelQualityReplacements = (direction: QualityDirection): void => {
  requests = requests
    .then(async () => {
      const ids = qualityJobsToCancel(await WaveSoulseek.jobsSnapshot(), direction);
      for (const id of ids) await WaveSoulseek.cancelJob(id);
      if (ids.length > 0) await refresh();
    })
    .catch(() => undefined);
};

/** The download journal as JS last followed it, following it (Core's `qualityUpgradeSongs` reads it). */
export const useDownloadJournal = (): readonly NativeDownloadJob[] =>
  useSyncExternalStore(journal.subscribe, journal.get);

/** The download journal as JS last followed it. */
export const downloadJournal = (): readonly NativeDownloadJob[] => journal.get();

/** Where downloading the missing songs stands (Core's `missingSongsDownload`), following both. */
export const useMissingSongsDownload = (): MissingSongsDownload<MissingSongJob> => {
  const missing: readonly MissingTrack[] = useMissingSongs();
  const jobs = useSyncExternalStore(journal.subscribe, journal.get);
  const songs = useMemo(() => missing.map(missingSongJob), [missing]);
  return useMemo(() => missingSongsDownload(songs, jobs), [songs, jobs]);
};

/**
 * Settings › Downloads' Downloading list (Core's `downloadingList`), following the journal: the
 * songs downloading now, then the waiting ones grouped by the playlist, album or mix they're from.
 */
export const useDownloadingList = (): DownloadingList<NativeYtSong> => {
  const jobs = useSyncExternalStore(journal.subscribe, journal.get);
  return useMemo(() => downloadingList(jobs), [jobs]);
};

/** Whether any download is queued or downloading (Core's `queuedDownloads`), as the journal last said. */
export const downloadsOnTheirWay = (): boolean => queuedDownloads(journal.get()).length > 0;

/** Calls [listener] whenever the journal changes; returns how to stop. */
export const onDownloadsChanged = (listener: () => void): (() => void) =>
  journal.subscribe(listener);

/**
 * Settings › Downloads' Cancel on a song on its way: as its menu's Cancel Download, and every
 * video asked for on the job lets go of it, so a shared job ends too.
 */
export const cancelQueuedDownload = ({ cancel }: QueuedDownload<NativeYtSong>): void => {
  if (cancel === null) return;
  requests = requests
    .then(async () => {
      for (const videoId of cancel) await WaveSoulseek.cancelJob(videoId);
      await refresh();
    })
    .catch(() => undefined);
};

/**
 * Settings › Downloads' drag: the waiting jobs [ids] start in this order (Core's
 * `moveDownloadGroup` / `moveDownloadInGroup`). The list shows it at once (Core's
 * `moveQueuedJobs`, as the journal will do it), then follows the journal's own order again.
 */
export const moveQueuedDownloads = (ids: readonly string[]): void => {
  if (ids.length === 0) return;
  journal.set(moveQueuedJobs(journal.get(), ids));
  requests = requests
    .then(() => WaveSoulseek.moveQueuedJobs(ids))
    .catch(() => undefined)
    .then(async () => {
      // Shown again from the journal even when the move changed nothing there.
      shown = null;
      await refresh();
    })
    .catch(() => undefined);
};

/**
 * Settings › Downloads' failed songs (Core's `failedDownloads`), following the journal, the
 * Library (a song downloaded some other way leaves the list) and its missing songs (one filled
 * in or taken out leaves too).
 */
export const useFailedDownloads = (): readonly FailedDownload<NativeYtSong>[] => {
  const failed = useSyncExternalStore(journal.subscribe, failedJobsNow);
  const input = useFailedDownloadsInput(failed.length > 0);
  return useMemo(() => failedDownloads(failed, input), [failed, input]);
};

/**
 * What tells whether a failure settled another way: the Library (read for the finder only
 * while [active], some download having failed) and its missing songs.
 */
const useFailedDownloadsInput = (active: boolean): FailedDownloadsInput<NativeYtSong> => {
  const find = useLoadedLibraryFinder(active);
  const missing = useLoadedMissingSongs();
  return useMemo(
    () => ({
      // Nothing has settled until the Library is read.
      inLibrary: (song: NativeYtSong) => find !== null && find(song) !== null,
      missingTrackIds: missing === null ? null : new Set(missing.map((track) => track.id)),
    }),
    [find, missing],
  );
};

/**
 * The Settings row's counts (Core's `failedDownloadCount`, `queuedDownloadCounts`): how many songs
 * failed, and how many are downloading, saving and waiting, without building either list.
 */
export const useDownloadCounts = (): { failed: number; queued: QueuedDownloadCounts } => {
  const failedJobsList = useSyncExternalStore(journal.subscribe, failedJobsNow);
  const queued = useSyncExternalStore(journal.subscribe, queuedCountsNow);
  const input = useFailedDownloadsInput(failedJobsList.length > 0);
  const failed = useMemo(() => failedDownloadCount(failedJobsList, input), [failedJobsList, input]);
  return useMemo(() => ({ failed, queued }), [failed, queued]);
};

/**
 * Settings › Downloads' Retry and Retry All: asks again for each of [failed], in order, from
 * the source Core picks now; a missing song only while it's still missing.
 */
export const retryFailedDownloads = (failed: readonly FailedDownload<NativeYtSong>[]): void => {
  askForNotifications();
  startDownloads();
  requests = requests
    .then(async () => {
      await enqueueJobs(await retryRequests(failed));
      await refresh();
    })
    .catch(() => undefined);
};

/** What Retry asks the journal for again, for each of [failed] (`retryFailedDownloads`). */
const retryRequests = async (
  failed: readonly FailedDownload<NativeYtSong>[],
): Promise<JobRequest[]> => {
  const trackIds = failed.flatMap(({ retry }) =>
    retry.kind === "missingSong" ? [retry.trackId] : [],
  );
  const missing = new Map(
    (trackIds.length === 0 ? [] : await missingSongJobs(trackIds)).map((job) => [
      job.missing.trackId,
      job,
    ]),
  );
  const session = await sessionNow();
  const ytMusicOn = ytMusicEnabled();
  const asked: JobRequest[] = [];
  for (const { retry } of failed) {
    if (retry.kind === "quality") {
      asked.push(...(await qualityReplacementRequests(retry.direction, [retry.trackId])));
    } else if (retry.kind === "song") {
      // Asked with no origin, the job keeps the one it was first asked from.
      asked.push(songRequest(retry.song, null, currentSource(session, ytMusicOn), null));
    } else {
      const job = missing.get(retry.trackId);
      if (job !== undefined) asked.push(missingSongRequest(job, session, ytMusicOn));
    }
  }
  return asked;
};

/**
 * Settings › Downloads' Clear All and each row's trash button: [failed] leave the list and the
 * journal. Every video asked for on a job lets go of it, so a shared job ends too.
 */
export const clearFailedDownloads = (failed: readonly FailedDownload<NativeYtSong>[]): void => {
  requests = requests
    .then(async () => {
      for (const { clear } of failed)
        for (const videoId of clear) await WaveSoulseek.cancelJob(videoId);
      await refresh();
    })
    .catch(() => undefined);
};

/**
 * A star means downloaded: starring YT Music [songs] and missing songs [trackIds] (Core's
 * `starredDownload`) queues each one never asked for under Favorites, the star the only one
 * that asked; asks again for a failed one, keeping where it was asked from; and leaves one
 * already on its way as it is. A song sharing a job on its way (another result id of the same
 * recording) leaves that job be too: its pending favorite settles when the job's file arrives.
 */
export const downloadStarredSongs = (
  songs: readonly NativeYtSong[],
  trackIds: readonly number[] = [],
): void => {
  if (songs.length === 0 && trackIds.length === 0) return;
  askForNotifications();
  startDownloads();
  requests = requests
    .then(async () => {
      const [jobs, missing] = await Promise.all([
        WaveSoulseek.jobsSnapshot(),
        trackIds.length === 0 ? Promise.resolve([]) : missingSongJobs(trackIds),
      ]);
      const state = ytDownloadsFromJournal(jobs);
      const queued: string[] = [];
      const session = await sessionNow();
      const ytMusicOn = ytMusicEnabled();
      const asked: JobRequest[] = [];
      for (const song of songs) {
        const shared = ytDownloadSharedJob(jobs, song);
        const step = starredDownload(
          ytDownloadStatus(state, song.videoId) ??
            (shared === null ? null : ytDownloadStatus(state, shared)),
        );
        if (step === "keep") continue;
        asked.push(
          songRequest(
            song,
            shared,
            currentSource(session, ytMusicOn),
            step === "queue" ? FAVORITES_DOWNLOAD_ORIGIN : null,
          ),
        );
        if (step === "queue") queued.push(song.videoId);
      }
      for (const job of inOrder(missing, trackIds)) {
        const step = starredDownload(ytDownloadStatus(state, job.videoId));
        if (step === "keep") continue;
        asked.push(
          missingSongRequest(
            job,
            session,
            ytMusicOn,
            step === "queue" ? FAVORITES_DOWNLOAD_ORIGIN : null,
          ),
        );
        if (step === "queue") queued.push(job.videoId);
      }
      await enqueueJobs(asked);
      starAsked.set(starAskedAfter(starAsked.get(), { kind: "starred", queued }));
      await refresh();
    })
    .catch(() => undefined);
};

/**
 * Unstarring YT Music songs (by video, [videoIds]) and missing songs [trackIds] before their
 * files arrive (Core's `unstarredDownload`): a download only the star asked for is cancelled,
 * waiting, downloading or failed; one the owner asked for separately carries on, as does one
 * already saving to the Library.
 */
export const cancelUnstarredDownloads = (
  videoIds: readonly string[],
  trackIds: readonly number[] = [],
): void => {
  const ids = [...videoIds, ...trackIds.map(missingSongJobId)];
  if (ids.length === 0) return;
  // In turn after the stars before it, so a star taken straight back finds its download.
  requests = requests
    .then(async () => {
      if (!ids.some((id) => starAsked.get().has(id))) return;
      const state = ytDownloadsFromJournal(await WaveSoulseek.jobsSnapshot());
      const asked = starAsked.get();
      for (const id of ids) {
        const step = unstarredDownload(ytDownloadStatus(state, id), { starAsked: asked.has(id) });
        if (step === "cancel") await WaveSoulseek.cancelJob(id);
      }
      starAsked.set(starAskedAfter(starAsked.get(), { kind: "unstarred", ids }));
      await refresh();
    })
    .catch(() => undefined);
};
