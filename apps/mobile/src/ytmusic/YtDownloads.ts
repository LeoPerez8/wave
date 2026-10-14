/**
 * The Download menu and rows of YT Music songs, backed by the native journal: Core picks the
 * source (`downloadSource`), Soulseek's automatic recording selection or YouTube Music's M4A,
 * and what the journal does when a source fails, YouTube Music's fallback included
 * (`downloadFailurePlan`).
 */
import {
  YT_DOWNLOADS_NONE,
  downloadFailurePlan,
  downloadSource,
  isWithin,
  soulseekCandidates,
  soulseekQuery,
  soulseekReceivedMatches,
  soulseekRecording,
  ytAlbumDownload,
  ytAudioMatches,
  ytDownloadDestination,
  ytDownloadLookup,
  ytDownloadSharedJob,
  ytDownloadStatus,
  ytDownloadTags,
  ytDownloadsFromJournal,
  ytPlaylistDownload,
  ytSongsDownload,
  type DownloadFailurePlan,
  type DownloadSource,
  type MixedSong,
  type SoulseekCandidate,
  type YtAlbumDownload,
  type YtAlbumDownloadAction,
  type YtPlaylistDownload,
  type YtPlaylistDownloadAction,
  type YtDownloadFailure,
  type YtDownloadStatus,
  type YtDownloadTags,
  type YtDownloads,
} from "@wave/core";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import { useMemo, useSyncExternalStore } from "react";
import { PermissionsAndroid, Platform } from "react-native";

import { libraryEdited, toIndexedArtwork, toIndexedTrack } from "@/library/LibraryScan";
import { LibraryStore } from "@/library/LibraryStore";
import { refreshDownloadPolicy } from "@/library/downloadPolicy";
import { fillInLyricsAndGenre, lookUpLyricsAndGenre } from "@/library/lyricsAndGenre";
import { appRuntime } from "@/library/runtime";
import { makeExternalStore } from "@/lib/externalStore";
import {
  WaveSoulseek,
  soulseekErrorCode,
  type NativeDownloadDecision,
  type NativeDownloadJob,
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

/** Core's source for a download now: YT Music's setting and Download in best quality. */
const currentSource = (
  session: SoulseekSession,
  ytMusicOn = ytMusicEnabled(),
): DownloadSource | null => downloadSource({ ytMusicOn, bestQuality: session.status !== "off" });

/**
 * What the journal keeps to carry a Soulseek job on from YouTube Music: where the M4A goes and
 * what it does when YouTube fails too. The failures that hand the job over are in the Soulseek
 * plan (`fallsBack`).
 */
interface DownloadFallbackPlan {
  readonly source: "youtube";
  readonly targetPath: string;
  readonly failurePlan: DownloadFailurePlan;
}

/** The journal's answer to "prepare": a plan, or Soulseek's failure with what falls back from it. */
type PrepareAnswer =
  | {
      readonly source: DownloadSource;
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
const requestedSource = async (): Promise<DownloadSource | null> => {
  try {
    return currentSource(await WaveSoulseek.session());
  } catch {
    return currentSource({ status: "off", username: null });
  }
};

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
    ]).pipe(Effect.mapError((cause) => new DownloadFailed({ reason: "storage", cause })));
    if (roots.length === 0) return yield* new DownloadFailed({ reason: "noFolder" });
    const ytMusicOn = ytMusicEnabled();
    const source = currentSource(yield* native(() => WaveSoulseek.session()), ytMusicOn);
    if (source === null) return yield* new DownloadFailed({ reason: "noSource" });
    if (source === "youtube") {
      const tags = yield* metadata(song);
      const target = ytDownloadDestination(roots, excludedFolders, tags, source);
      if (target === null) return yield* new DownloadFailed({ reason: "noFolder" });
      return {
        source,
        candidates: [],
        tags,
        targetPath: target.path,
        failurePlan: downloadFailurePlan(source, { ytMusicOn }),
      } satisfies PrepareAnswer;
    }
    const query = soulseekQuery(song);
    const [found, tags] = yield* Effect.all(
      [
        Effect.result(
          query === ""
            ? Effect.fail(new DownloadFailed({ reason: "unavailable" }))
            : native(() => WaveSoulseek.search(query)),
        ),
        metadata(song),
      ],
      { concurrency: "unbounded" },
    );
    const youtube = ytMusicOn
      ? ytDownloadDestination(roots, excludedFolders, tags, "youtube")
      : null;
    // YouTube Music carries the job on only where its M4A has a place.
    const failurePlan = downloadFailurePlan(source, { ytMusicOn: youtube !== null });
    const fallback: { readonly fallback?: DownloadFallbackPlan } =
      youtube === null
        ? {}
        : {
            fallback: {
              source: "youtube",
              targetPath: youtube.path,
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
    const target = ytDownloadDestination(roots, excludedFolders, tags, source);
    if (target === null) return yield* new DownloadFailed({ reason: "noFolder" });
    return {
      source,
      candidates,
      tags,
      targetPath: target.path,
      failurePlan,
      ...fallback,
    } satisfies PrepareAnswer;
  });

/** Recheck current folders both before publication and before recovered completion import. */
export const downloadPathIncluded = (path: string) =>
  Effect.gen(function* () {
    const store = yield* LibraryStore;
    const [roots, excluded] = yield* Effect.all([store.listRoots, store.excludedFolders]).pipe(
      Effect.mapError((cause) => new DownloadFailed({ reason: "storage", cause })),
    );
    return (
      roots.some((root) => isWithin(path, root.path)) &&
      !excluded.some((folder) => isWithin(path, folder))
    );
  });

/** Transactional upsert preserves ids, favorites, playlists and history on repeated delivery. */
export const importDownload = (saved: NativeSavedDownload) =>
  Effect.gen(function* () {
    if (!(yield* downloadPathIncluded(saved.path)))
      return yield* new DownloadFailed({ reason: "noFolder" });
    const store = yield* LibraryStore;
    yield* store
      .saveBatch(
        [toIndexedTrack(saved.track)],
        saved.artwork === null ? [] : [toIndexedArtwork(saved.artwork)],
      )
      .pipe(Effect.mapError((cause) => new DownloadFailed({ reason: "storage", cause })));
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

/** The answer to one decision the native journal leased to JS. */
const answer = (claim: NativeDownloadDecision) =>
  Effect.gen(function* () {
    switch (claim.decision) {
      case "prepare":
        return yield* prepareDownload(claim.song);
      case "confirm": {
        if (claim.audio === undefined) return yield* new DownloadFailed({ reason: "failed" });
        if (!("receivedTags" in claim.audio)) {
          // YouTube's M4A arrived complete; it's the song when it plays as long.
          const { durationMs } = claim.audio;
          const acceptable = ytAudioMatches(claim.song, durationMs);
          if (!acceptable)
            console.warn("[wave] YouTube's audio isn't the song's length", { durationMs });
          return { receiptId: claim.receiptId, acceptable };
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
        return { path: yield* importDownload(claim.saved) };
      }
    }
  }).pipe(
    Effect.catch((error) =>
      Effect.succeed({ failure: error instanceof DownloadFailed ? error.reason : "storage" }),
    ),
  );

/** A download as Find Lyrics and Genre sees it: what its file says once tagged and saved. */
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
      const jobs = await WaveSoulseek.jobsSnapshot();
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

let attached = false;
/**
 * Follows the native journal. The app and the headless task (started by the
 * download service after process recreation) share this; the app also asks
 * the service to resume work the journal still holds.
 */
export const startDownloads = (resume = false): void => {
  if (!attached) {
    attached = true;
    WaveSoulseek.addListener("onJobsChanged", refreshQuietly);
  }
  // Replays anything that changed before the listener was attached, e.g. while JS was starting.
  refreshQuietly();
  if (resume) void WaveSoulseek.resumeJobs().catch(() => undefined);
};

let askedForNotifications = false;
const askForNotifications = (): void => {
  if (askedForNotifications || Platform.OS !== "android" || Number(Platform.Version) < 33) return;
  askedForNotifications = true;
  void PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS).catch(
    () => undefined,
  );
};

let requests = Promise.resolve();
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

/** A playlist's entry: a Library song (its file) or a YT Music song. */
type PlaylistEntry = MixedSong<NativeYtSong, { readonly path: string }>;

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
