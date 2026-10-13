/** The existing Download menu/row backed by automatic Soulseek acquisition. */
import {
  YT_DOWNLOADS_NONE,
  isWithin,
  soulseekCandidates,
  soulseekReceivedMatches,
  soulseekRecording,
  ytDownloadDestination,
  ytDownloadLookup,
  ytDownloadSharedJob,
  ytDownloadStatus,
  ytDownloadTags,
  ytDownloadsFromJournal,
  type FoundTags,
  type YtDownloadFailure,
  type YtDownloadStatus,
  type YtDownloads,
} from "@wave/core";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import { useSyncExternalStore } from "react";
import { PermissionsAndroid, Platform } from "react-native";

import { libraryEdited, toIndexedArtwork, toIndexedTrack } from "@/library/LibraryScan";
import { LibraryStore } from "@/library/LibraryStore";
import { refreshDownloadPolicy } from "@/library/downloadPolicy";
import { lookUpLyricsAndGenre } from "@/library/lyricsAndGenre";
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
} from "@/native/waveYtDownloads";

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

/** Optional metadata cannot fail or indefinitely hold up valid audio acquisition. */
const metadata = (song: NativeYtSong) =>
  Effect.gen(function* () {
    const album = yield* optional(
      Effect.gen(function* () {
        const albumId =
          song.albumId ?? (yield* native(() => WaveYtDownloads.watchSong(song.videoId))).albumId;
        return albumId === null ? null : yield* native(() => WaveYtDownloads.album(albumId));
      }),
    );
    const lookup = ytDownloadLookup(song, album);
    const [found, lyrics] = yield* Effect.all(
      [
        lookup === null
          ? Effect.succeed<FoundTags | null>(null)
          : optional(lookUpLyricsAndGenre(lookup)),
        optional(
          Effect.gen(function* () {
            const page = yield* native(() => WaveYtDownloads.watchSong(song.videoId));
            return page.lyricsBrowseId === null
              ? null
              : yield* native(() => WaveYtDownloads.lyrics(page.lyricsBrowseId!));
          }),
        ),
      ],
      { concurrency: "unbounded" },
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
    const [reports, tags] = yield* Effect.all(
      [native(() => WaveSoulseek.search(`${song.artists[0] ?? ""} ${song.title}`)), metadata(song)],
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
      case "confirm":
        if (claim.audio === undefined) return yield* new DownloadFailed({ reason: "failed" });
        return {
          receiptId: claim.receiptId,
          acceptable: soulseekReceivedMatches(
            claim.song,
            claim.audio.receivedTags,
            claim.audio.durationMs,
          ),
        };
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

const answering = new Set<string>();
/** Claims and answers [id]'s pending decision; an unanswered lease expires natively and is offered again. */
const answerJob = async (id: string): Promise<void> => {
  if (answering.has(id)) return;
  answering.add(id);
  try {
    const claim = await WaveSoulseek.claimDecision(id);
    if (claim === null) return;
    const payload = await appRuntime.runPromise(answer(claim));
    await WaveSoulseek.submitDecision(
      claim.id,
      claim.generation,
      claim.token,
      claim.decision,
      payload,
    );
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
      downloads.set(ytDownloadsFromJournal(jobs));
      for (const job of jobs) if (awaitsAnswer(job)) void answerJob(job.id);
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
    // Snapshots replay anything an event missed, e.g. while JS was starting.
    setInterval(refreshQuietly, 1_000);
  }
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
