/** The existing Download menu/row backed by automatic Soulseek acquisition. */
import {
  YT_DOWNLOADS_NONE,
  isWithin,
  soulseekCandidates,
  soulseekQuery,
  soulseekReceivedMatches,
  soulseekRecording,
  ytAlbumDownload,
  ytDownloadDestination,
  ytDownloadLookup,
  ytDownloadSharedJob,
  ytDownloadStatus,
  ytDownloadTags,
  ytDownloadsFromJournal,
  type YtAlbumDownload,
  type YtAlbumDownloadAction,
  type YtDownloadFailure,
  type YtDownloadStatus,
  type YtDownloads,
} from "@wave/core";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
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
} from "@/native/waveSoulseek";
import type { NativeYtSong } from "@/native/waveYtMusic";
import {
  WaveYtDownloads,
  ytDownloadErrorCode,
  type NativeSavedDownload,
  type NativeYtWatchSong,
} from "@/native/waveYtDownloads";

import { readYtAlbum } from "./albumPages";

export class DownloadFailed extends Data.TaggedError("DownloadFailed")<{
  readonly reason: YtDownloadFailure;
  readonly cause?: unknown;
}> {}

const failure = (cause: unknown): DownloadFailed => {
  const code = soulseekErrorCode(cause) ?? ytDownloadErrorCode(cause);
  return new DownloadFailed({
    reason:
      code === "ERR_SLSK_SIGNED_OUT" || code === "ERR_SLSK_AUTH"
        ? "account"
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

/** The journal's "prepare" decision: the peers with this recording, its tags and where it goes. */
export const prepareSoulseekDownload = (song: NativeYtSong) =>
  Effect.gen(function* () {
    const store = yield* LibraryStore;
    const [roots, excludedFolders] = yield* Effect.all([
      store.listRoots,
      store.excludedFolders,
    ]).pipe(Effect.mapError((cause) => new DownloadFailed({ reason: "storage", cause })));
    if (roots.length === 0) return yield* new DownloadFailed({ reason: "noFolder" });
    const session = yield* native(() => WaveSoulseek.session());
    if (session.status === "signedOut") return yield* new DownloadFailed({ reason: "account" });
    const query = soulseekQuery(song);
    if (query === "") return yield* new DownloadFailed({ reason: "unavailable" });
    const [reports, tags] = yield* Effect.all(
      [native(() => WaveSoulseek.search(query)), metadata(song)],
      { concurrency: "unbounded" },
    );
    const candidates = soulseekCandidates(song, reports);
    if (candidates.length === 0) return yield* new DownloadFailed({ reason: "unavailable" });
    const target = ytDownloadDestination(roots, excludedFolders, tags);
    if (target === null) return yield* new DownloadFailed({ reason: "noFolder" });
    return { candidates, tags, target };
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
export const importSoulseekDownload = (saved: NativeSavedDownload) =>
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
/** The journal's last snapshot as it came, for album-level views (Core's `ytAlbumDownload`). */
const journal = makeExternalStore<readonly NativeDownloadJob[]>([]);

/** Re-reads folder policy so a publication never lands outside the current Library folders. */
const publicationTarget = (claim: NativeDownloadDecision) =>
  Effect.gen(function* () {
    const { roots, excludedFolders, revision } = yield* refreshDownloadPolicy;
    if (claim.tags === undefined) return yield* new DownloadFailed({ reason: "failed" });
    const target = ytDownloadDestination(roots, excludedFolders, claim.tags);
    if (target === null) return yield* new DownloadFailed({ reason: "noFolder" });
    return { targetPath: target.path, revision };
  });

/** The answer to one decision the native journal leased to JS. */
const answer = (claim: NativeDownloadDecision) =>
  Effect.gen(function* () {
    switch (claim.decision) {
      case "prepare": {
        const plan = yield* prepareSoulseekDownload(claim.song);
        return { candidates: plan.candidates, tags: plan.tags, targetPath: plan.target.path };
      }
      case "confirm": {
        if (claim.audio === undefined) return yield* new DownloadFailed({ reason: "failed" });
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
        return { path: yield* importSoulseekDownload(claim.saved) };
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
      await WaveSoulseek.enqueueJob(song, soulseekRecording(song), shared);
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
 * Download Album: every song of the album the Library doesn't have joins the
 * queue, in album order, sharing jobs already on their way (Core's
 * `ytAlbumDownload`, decided on a fresh snapshot of the journal). Each goes
 * through the single-song pipeline.
 */
export const downloadYtAlbum = (songs: readonly NativeYtSong[], inLibrary: InLibrary): void => {
  askForNotifications();
  startDownloads();
  requests = requests
    .then(async () => {
      const jobs = await WaveSoulseek.jobsSnapshot();
      for (const { song, sharedJob } of ytAlbumDownload(songs, { inLibrary, jobs }).toDownload)
        await WaveSoulseek.enqueueJob(song, soulseekRecording(song), sharedJob);
      await refresh();
    })
    .catch(() => undefined);
};

/**
 * Retry Failed: asks again for each of the album's songs whose download
 * failed, in album order, sharing jobs already on their way as Download Album does.
 */
export const retryYtAlbum = (songs: readonly NativeYtSong[], inLibrary: InLibrary): void => {
  askForNotifications();
  startDownloads();
  requests = requests
    .then(async () => {
      const jobs = await WaveSoulseek.jobsSnapshot();
      for (const { song, sharedJob } of ytAlbumDownload(songs, { inLibrary, jobs }).toRetry)
        await WaveSoulseek.enqueueJob(song, soulseekRecording(song), sharedJob);
      await refresh();
    })
    .catch(() => undefined);
};

/** Cancel Album Download: the album's songs leave the jobs that aren't saving yet. */
export const cancelYtAlbum = (songs: readonly NativeYtSong[], inLibrary: InLibrary): void => {
  requests = requests
    .then(async () => {
      const jobs = await WaveSoulseek.jobsSnapshot();
      for (const videoId of ytAlbumDownload(songs, { inLibrary, jobs }).toCancel)
        await WaveSoulseek.cancelJob(videoId);
      await refresh();
    })
    .catch(() => undefined);
};

/** Runs an album entry (Core's `ytAlbumDownload` actions) on [songs]. */
export const runYtAlbumAction = (
  action: YtAlbumDownloadAction,
  songs: readonly NativeYtSong[],
  inLibrary: InLibrary,
): void => {
  switch (action) {
    case "downloadAlbum":
      downloadYtAlbum(songs, inLibrary);
      return;
    case "retryFailed":
      retryYtAlbum(songs, inLibrary);
      return;
    case "cancelAlbumDownload":
      cancelYtAlbum(songs, inLibrary);
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
