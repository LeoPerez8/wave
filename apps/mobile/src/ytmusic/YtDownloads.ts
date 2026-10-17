/**
 * The Download menu and rows of YT Music songs, backed by the native journal: Core picks the
 * source (`downloadSource`), Soulseek's automatic recording selection or YouTube Music's M4A,
 * and what the journal does when a source fails, YouTube Music's fallback included
 * (`downloadFailurePlan`).
 */
import {
  YT_DOWNLOADS_NONE,
  downloadFailureAnswer,
  downloadFailurePlan,
  downloadSource,
  downloadStorageFull,
  failedDownloads,
  isWithin,
  libraryFinder,
  missingSongJob,
  missingSongJobId,
  missingSongLookup,
  missingSongSearch,
  missingSongTags,
  missingSongTrackId,
  missingSongVideo,
  missingSongsDownload,
  queuedDownloads,
  settledDownloadFailures,
  soulseekCandidates,
  soulseekQuery,
  soulseekReceivedMatches,
  soulseekRecording,
  spotifySearchQuery,
  ytAlbumDownload,
  ytAudioRejection,
  ytAudioTrack,
  ytDownloadDestination,
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
  type DownloadSource,
  type FailedDownload,
  type MissingSongJob,
  type MissingSongVideo,
  type MissingSongsDownload,
  type MissingSongsDownloadAction,
  type MissingTrack,
  type PlaylistItem,
  type QueuedDownload,
  type SoulseekCandidate,
  type YtAlbumDownload,
  type YtAlbumDownloadAction,
  type YtPlaylistDownload,
  type YtPlaylistDownloadAction,
  type YtDownloadFailure,
  type YtDownloadStatus,
  type YtDownloadTags,
  type YtDownloads,
  type YtSong,
} from "@wave/core";
import * as Cause from "effect/Cause";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import { useMemo, useSyncExternalStore } from "react";

import { appLog } from "@/log/appLog";

import { askForNotifications } from "@/lib/askForNotifications";
import {
  libraryEdited,
  libraryVersion,
  toIndexedArtwork,
  toIndexedTrack,
} from "@/library/LibraryScan";
import { LibraryStore, type SongRow } from "@/library/LibraryStore";
import { useLoadedMissingSongs, useMissingSongs } from "@/library/hooks";
import { refreshDownloadPolicy } from "@/library/downloadPolicy";
import { fillInLyricsAndGenre, lookUpLyricsAndGenre } from "@/library/lyricsAndGenre";
import { appRuntime } from "@/library/runtime";
import { makeExternalStore } from "@/lib/externalStore";
import {
  WaveSoulseek,
  soulseekErrorCode,
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
import { useLoadedLibraryFinder } from "./libraryFinder";
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
 * when LRCLIB has none.
 */
const metadata = (song: NativeYtSong) =>
  Effect.gen(function* () {
    let watchPage: Promise<NativeYtWatchSong> | undefined;
    const watch = () => native(() => (watchPage ??= WaveYtDownloads.watchSong(song.videoId)));
    const album = yield* optional(
      Effect.gen(function* () {
        const albumId = song.albumId ?? (yield* watch()).albumId;
        return albumId === null ? null : yield* native(() => readYtAlbum(albumId));
      }),
    );
    const lookup = ytDownloadLookup(song, album);
    const found = lookup === null ? null : yield* optional(lookUpLyricsAndGenre(lookup));
    const lyrics =
      found !== null && found.lyrics !== null
        ? null
        : yield* optional(
            Effect.gen(function* () {
              const { lyricsBrowseId } = yield* watch();
              return lyricsBrowseId === null
                ? null
                : yield* native(() => WaveYtDownloads.lyrics(lyricsBrowseId));
            }),
          );
    return ytDownloadTags(song, album, found, lyrics);
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
 * The video a YouTube download of [song] asks for in place of its own: its audio track, from a
 * YT Music Songs search (Core's `ytAudioTrack`). YT Music's album pages may list a song under
 * its music video, whose audio isn't the album cut's length. Undefined keeps the song's own
 * video, as a search that fails does: the length check still judges what it serves.
 */
const audioTrack = (song: YtSong) =>
  Effect.gen(function* () {
    const ytMusic = yield* YtMusic;
    const page = yield* ytMusic
      .searchSongs(spotifySearchQuery(song))
      .pipe(Effect.orElseSucceed(() => null));
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
        : ytMusic.searchSongs(search).pipe(
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
 * Transactional upsert preserves ids, favorites, playlists and history on
 * repeated delivery. A song downloaded from YouTube Music keeps its
 * [videoId] on its Track; a Soulseek download has none. A missing song's
 * download fills in its Track ([fills]), so its places, star and plays stay.
 */
export const importDownload = (
  saved: NativeSavedDownload,
  videoId: string | null,
  fills: number | null = null,
) =>
  Effect.gen(function* () {
    if (!(yield* downloadPathIncluded(saved.path)))
      return yield* new DownloadFailed({ reason: "noFolder" });
    const store = yield* LibraryStore;
    yield* store
      .saveBatch(
        [{ ...toIndexedTrack(saved.track), videoId, ...(fills === null ? {} : { fills }) }],
        saved.artwork === null ? [] : [toIndexedArtwork(saved.artwork)],
      )
      .pipe(Effect.mapError(libraryFailure));
    libraryEdited();
    return saved.path;
  });

const downloads = makeExternalStore<YtDownloads<NativeYtSong>>(YT_DOWNLOADS_NONE);
/** The journal's last snapshot as it came, for album and playlist views (Core's `ytSongsDownload`). */
const journal = makeExternalStore<readonly NativeDownloadJob[]>([]);

/** Re-reads folder policy so a publication never lands outside the current Library folders. */
const publicationTarget = (claim: NativeDownloadDecision) =>
  Effect.gen(function* () {
    const { roots, excludedFolders, revision } = yield* refreshDownloadPolicy;
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
  // A missing song's job has no video of its own: its length is its Track's.
  const missing = missingSongTrackId(claim.id) !== null;
  return ytDownloadReport({
    song: missing ? null : claim.song.videoId,
    requested: audio.requested ?? claim.video ?? claim.song.videoId,
    resolved: audio.resolved ?? null,
    client: audio.client ?? null,
    videoType: audio.videoType ?? null,
    announcedMs: audio.announcedMs ?? null,
    expectedMs: claim.song.durationMs,
    expectedFrom: missing ? "library" : "ytMusic",
    measuredMs: audio.durationMs,
  });
};

/** The answer to one decision the native journal leased to JS. */
const answer = (claim: NativeDownloadDecision) =>
  Effect.gen(function* () {
    switch (claim.decision) {
      case "prepare": {
        // Soulseek handed the job over to YouTube Music, whose turn starts here.
        if (claim.fellBackFrom !== undefined && claim.source === "youtube")
          return yield* prepareFallback(claim);
        const trackId = missingSongTrackId(claim.id);
        return trackId === null
          ? yield* prepareDownload(claim.song)
          : yield* prepareMissingSong(trackId);
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
        // A missing song's job is named after its Track: its video is the one prepare named.
        const fills = missingSongTrackId(claim.id);
        // A job from before YouTube Music downloads is Soulseek's.
        const videoId =
          claim.source !== "youtube"
            ? null
            : (claim.video ?? (fills === null ? claim.song.videoId : null));
        return { path: yield* importDownload(claim.saved, videoId, fills) };
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
  // The track number and year as the index reads them ("3/12" is 3).
  const { trackNumber, year } = toIndexedTrack(track);
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
  };
};

const answering = new Set<string>();
/** Claims and answers [id]'s pending decision; an unanswered lease expires natively and is offered again. */
const answerJob = async (id: string): Promise<void> => {
  if (answering.has(id)) return;
  answering.add(id);
  try {
    const claim = await WaveSoulseek.claimDecision(id);
    if (claim === null) return;
    const payload = await appRuntime.runPromise(answer(claim));
    const accepted = await WaveSoulseek.submitDecision(
      claim.id,
      claim.generation,
      claim.token,
      claim.decision,
      JSON.stringify(payload),
    );
    if (accepted && claim.decision === "import" && claim.saved !== undefined && "path" in payload)
      void appRuntime.runPromise(fillInLyricsAndGenre(downloadedSong(claim.saved)));
  } catch {
    // JS or the bridge went away mid-answer: the native lease expires and replays the decision.
  } finally {
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

/** The last snapshot rows were given, so an unchanged one doesn't re-render them. */
let shown = "";
/** A slow re-read while downloads are unfinished, in case an event was missed. */
let poll: ReturnType<typeof setInterval> | null = null;

let refreshing = false;
let refreshAgain = false;
/** Read once per Library version, including when downloads finish between edits. */
let downloadLibrary: { readonly version: number; readonly songs: readonly SongRow[] } | null = null;
/** Progress on unfinished jobs doesn't change which finished jobs the Library still has. */
let reconciledDownloads = "";

/** Core's finished jobs to forget, decided against a Library read after their journal snapshot. */
const forgetDeletedDownloads = async (
  jobs: readonly NativeDownloadJob[],
): Promise<readonly NativeDownloadJob[]> => {
  if (!jobs.some((job) => job.phase === "completed" && job.acknowledged === true)) return jobs;
  const version = libraryVersion.get();
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
    if (version !== libraryVersion.get()) {
      refreshAgain = true;
      return jobs;
    }
    downloadLibrary = { version, songs };
  }
  const forgotten = new Set<string>();
  for (const id of ytDownloadsToForget(jobs, downloadLibrary.songs)) {
    if (version !== libraryVersion.get()) {
      refreshAgain = true;
      break;
    }
    const job = jobs.find((candidate) => candidate.id === id);
    if (job !== undefined && (await WaveSoulseek.forgetCompletedJob(id, job.generation)))
      forgotten.add(id);
  }
  if (version === libraryVersion.get()) reconciledDownloads = revision;
  return forgotten.size === 0 ? jobs : jobs.filter((job) => !forgotten.has(job.id));
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
      const snapshotJobs = await WaveSoulseek.jobsSnapshot();
      // A failed Library read keeps the journal intact and mustn't hide new progress or decisions.
      const jobs = await forgetDeletedDownloads(snapshotJobs).catch(() => snapshotJobs);
      const snapshot = JSON.stringify(jobs);
      if (snapshot !== shown) {
        shown = snapshot;
        downloads.set(ytDownloadsFromJournal(jobs));
        journal.set(jobs);
      }
      for (const job of jobs) if (awaitsAnswer(job)) void answerJob(job.id);
      const active = jobs.some(unfinished);
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
      });
      for (const videoId of settled) await WaveSoulseek.cancelJob(videoId);
      if (settled.length > 0) await refresh();
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
    WaveSoulseek.addListener("onJobsChanged", refreshQuietly);
    libraryVersion.subscribe(refreshQuietly);
  }
  // Replays anything that changed before the listener was attached, e.g. while JS was starting.
  refreshQuietly();
  if (resume) {
    void WaveSoulseek.resumeJobs().catch(() => undefined);
    forgetSettledFailures();
  }
};

export const downloadYtSong = (song: NativeYtSong): void => {
  askForNotifications();
  startDownloads();
  // One at a time, so a second tap sees the first one's job in the journal.
  requests = requests
    .then(async () => {
      const shared = ytDownloadSharedJob(await WaveSoulseek.jobsSnapshot(), song);
      await WaveSoulseek.enqueueJob(song, soulseekRecording(song), shared, await requestedSource());
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
 * Each goes through the single-song pipeline.
 */
const downloadYtSongs = (songs: readonly NativeYtSong[], inLibrary: InLibrary): void => {
  askForNotifications();
  startDownloads();
  requests = requests
    .then(async () => {
      const jobs = await WaveSoulseek.jobsSnapshot();
      const source = await requestedSource();
      for (const { song, sharedJob } of ytSongsDownload(songs, { inLibrary, jobs }).toDownload)
        await WaveSoulseek.enqueueJob(song, soulseekRecording(song), sharedJob, source);
      await refresh();
    })
    .catch(() => undefined);
};

/**
 * Retry Failed: asks again for each of the list's songs whose download
 * failed, in list order, sharing jobs already on their way as Download does.
 */
const retryYtSongs = (songs: readonly NativeYtSong[], inLibrary: InLibrary): void => {
  askForNotifications();
  startDownloads();
  requests = requests
    .then(async () => {
      const jobs = await WaveSoulseek.jobsSnapshot();
      const source = await requestedSource();
      for (const { song, sharedJob } of ytSongsDownload(songs, { inLibrary, jobs }).toRetry)
        await WaveSoulseek.enqueueJob(song, soulseekRecording(song), sharedJob, source);
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

/** Runs an album's or a playlist's download entry on its YT Music [songs]. */
export const runYtDownloadAction = (
  action: YtListDownloadAction,
  songs: readonly NativeYtSong[],
  inLibrary: InLibrary,
): void => {
  switch (action) {
    case "downloadAlbum":
    case "downloadPlaylist":
      downloadYtSongs(songs, inLibrary);
      return;
    case "retryFailed":
      retryYtSongs(songs, inLibrary);
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

/** A playlist's entry: a Library song (its file), a YT Music song, or an unavailable song. */
type PlaylistEntry = PlaylistItem<NativeYtSong, { readonly path: string | null }>;

/** What a playlist's download entries act on: its YT Music entries' songs, in playlist order. */
export const playlistYtSongs = (entries: readonly PlaylistEntry[]): NativeYtSong[] =>
  entries.flatMap((entry) => (entry.source === "stream" ? [entry.song] : []));

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

/** Asks the journal for missing song [job], from the source Core picks for it now. */
const enqueueMissingSong = (
  job: MissingSongJob,
  session: SoulseekSession,
  ytMusicOn: boolean,
): Promise<string> =>
  WaveSoulseek.enqueueJob(
    journalSong(job),
    soulseekRecording(job),
    null,
    currentSource(session, ytMusicOn, job.missing.videoId !== null),
  );

/** Asks the journal for missing songs [jobs], in order, each from the source Core picks for it. */
const enqueueMissingSongs = async (jobs: readonly MissingSongJob[]): Promise<void> => {
  const session = await sessionNow();
  const ytMusicOn = ytMusicEnabled();
  for (const job of jobs) await enqueueMissingSong(job, session, ytMusicOn);
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
 * Download Missing Songs, Retry Failed and Cancel Download), only those songs, in that order.
 */
export const runMissingSongsDownloadAction = (
  action: MissingSongsDownloadAction,
  trackIds?: readonly number[],
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
      switch (action) {
        case "downloadAll":
          await enqueueMissingSongs(download.toDownload);
          break;
        case "retryFailed":
          await enqueueMissingSongs(download.toRetry);
          break;
        case "cancel":
          for (const id of download.toCancel) await WaveSoulseek.cancelJob(id);
          break;
      }
      await refresh();
    })
    .catch(() => undefined);
};

/** Where downloading the missing songs stands (Core's `missingSongsDownload`), following both. */
export const useMissingSongsDownload = (): MissingSongsDownload<MissingSongJob> => {
  const missing: readonly MissingTrack[] = useMissingSongs();
  const jobs = useSyncExternalStore(journal.subscribe, journal.get);
  const songs = useMemo(() => missing.map(missingSongJob), [missing]);
  return useMemo(() => missingSongsDownload(songs, jobs), [songs, jobs]);
};

/**
 * Settings › Downloads' songs on their way (Core's `queuedDownloads`), following the journal: the
 * ones downloading first, then the waiting ones in queue order, each with its progress line.
 */
export const useQueuedDownloads = (): readonly QueuedDownload<NativeYtSong>[] => {
  const jobs = useSyncExternalStore(journal.subscribe, journal.get);
  return useMemo(() => queuedDownloads(jobs), [jobs]);
};

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
 * Settings › Downloads' failed songs (Core's `failedDownloads`), following the journal, the
 * Library (a song downloaded some other way leaves the list) and its missing songs (one filled
 * in or taken out leaves too).
 */
export const useFailedDownloads = (): readonly FailedDownload<NativeYtSong>[] => {
  const jobs = useSyncExternalStore(journal.subscribe, journal.get);
  // The Library is read for the finder only while some download has failed.
  const find = useLoadedLibraryFinder(jobs.some(hasFailed));
  const missing = useLoadedMissingSongs();
  const missingTrackIds = useMemo(
    () => (missing === null ? null : new Set(missing.map((track) => track.id))),
    [missing],
  );
  return useMemo(
    () =>
      failedDownloads(jobs, {
        // Nothing has settled until the Library is read.
        inLibrary: (song) => find !== null && find(song) !== null,
        missingTrackIds,
      }),
    [jobs, find, missingTrackIds],
  );
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
      for (const { retry } of failed) {
        if (retry.kind === "song") {
          const { song } = retry;
          await WaveSoulseek.enqueueJob(
            song,
            soulseekRecording(song),
            null,
            currentSource(session, ytMusicOn),
          );
        } else {
          const job = missing.get(retry.trackId);
          if (job !== undefined) await enqueueMissingSong(job, session, ytMusicOn);
        }
      }
      await refresh();
    })
    .catch(() => undefined);
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
