/** The existing Download menu/row backed by automatic Soulseek acquisition. */
import {
  YT_DOWNLOADS_NONE,
  isWithin,
  soulseekCandidates,
  soulseekReceivedMatches,
  soulseekRecording,
  soulseekSameRecording,
  ytDownloadDestination,
  ytDownloadLookup,
  ytDownloadStatus,
  ytDownloadTags,
  type FoundTags,
  type YtDownloadFailure,
  type YtDownloadPhase,
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
import { WaveSoulseek, soulseekErrorCode, type NativeDownloadJob, type NativeDownloadDecision } from "@/native/waveSoulseek";
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

/** Reusable preparation for the durable native queue; #115 first persists the original request. */
export const prepareSoulseekDownload = (
  song: NativeYtSong,
  onPhase: (phase: YtDownloadPhase) => void = () => {},
) =>
  Effect.gen(function* () {
    const store = yield* LibraryStore;
    const [roots, excludedFolders] = yield* Effect.all([
      store.listRoots,
      store.excludedFolders,
    ]).pipe(Effect.mapError((cause) => new DownloadFailed({ reason: "storage", cause })));
    if (roots.length === 0) return yield* new DownloadFailed({ reason: "noFolder" });
    onPhase("connecting");
    const session = yield* native(() => WaveSoulseek.session());
    if (session.status === "signedOut") return yield* new DownloadFailed({ reason: "account" });
    onPhase("searching");
    const [reports, tags] = yield* Effect.all(
      [native(() => WaveSoulseek.search(`${song.artists[0] ?? ""} ${song.title}`)), metadata(song)],
      { concurrency: "unbounded" },
    );
    const candidates = soulseekCandidates(song, reports);
    if (candidates.length === 0) return yield* new DownloadFailed({ reason: "unavailable" });
    const target = ytDownloadDestination(roots, excludedFolders, tags);
    if (target === null) return yield* new DownloadFailed({ reason: "noFolder" });
    return {
      song,
      candidates,
      tags,
      target,
      includedRoots: roots.map((root) => root.path),
      excludedFolders,
      recording: soulseekRecording(song),
    };
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
const status = (job: NativeDownloadJob): YtDownloadStatus => {
  if (job.importFailure !== undefined) return { kind: "failed", reason: job.importFailure };
  switch (job.phase) {
    case "queued": return { kind: "queued" };
    case "failed": return { kind: "failed", reason: job.reason ?? "failed" };
    case "completed": return job.acknowledged && job.saved !== undefined ? { kind: "done", path: job.saved.path } : { kind: "saving" };
    case "tagging": case "awaitingPublication": case "publishing": return { kind: "saving" };
    default: return { kind: "downloading", received: job.received ?? 0, total: job.total && job.total > 0 ? job.total : null,
      phase: job.phase === "preparing" ? "searching" : job.phase === "sourceReady" ? "validating" : job.queuePosition != null ? "queued" : "transferring" };
  }
};

const publicationContext = (claim: NativeDownloadDecision) => Effect.gen(function* () {
  const { roots, excludedFolders, revision } = yield* refreshDownloadPolicy;
  if (claim.tags === undefined) return yield* new DownloadFailed({ reason: "failed" });
  const target = ytDownloadDestination(roots, excludedFolders, claim.tags);
  if (target === null) return yield* new DownloadFailed({ reason: "noFolder" });
  return { targetPath: target.path, revision };
});

const answerDecision = (claim: NativeDownloadDecision) => Effect.gen(function* () {
  switch (claim.decision) {
    case "prepare": {
      const plan = yield* prepareSoulseekDownload(claim.song);
      return { candidates: plan.candidates, tags: plan.tags, targetPath: plan.target.path };
    }
    case "confirm": {
      if (claim.audio === undefined) return yield* new DownloadFailed({ reason: "failed" });
      return { receiptId: claim.receiptId, acceptable: soulseekReceivedMatches(claim.song, claim.audio.receivedTags, claim.audio.durationMs) };
    }
    case "publish": return yield* publicationContext(claim);
    case "import": {
      if (claim.saved === undefined) return yield* new DownloadFailed({ reason: "failed" });
      yield* refreshDownloadPolicy;
      const path = yield* importSoulseekDownload(claim.saved);
      return { path };
    }
  }
});

let attached = false;
let refreshing = false;
let refreshAgain = false;
const answering = new Set<string>();
const refresh = async (): Promise<void> => {
  if (refreshing) { refreshAgain = true; return; }
  refreshing = true;
  try {
    do {
      refreshAgain = false;
      const jobs = await WaveSoulseek.jobsSnapshot();
      downloads.set({ jobs: jobs.filter((job) => job.phase !== "cancelled").map((job) => ({ song: job.song, relatedSongs: job.aliases, status: status(job) })) });
      for (const job of jobs) {
        if (answering.has(job.id) || job.phase === "failed" || job.phase === "cancelled" || job.acknowledged || job.importFailure !== undefined) continue;
        answering.add(job.id);
        void (async () => {
          try {
            const claim = await WaveSoulseek.claimDecision(job.id);
            if (claim === null) return;
            const payload = await appRuntime.runPromise(answerDecision(claim).pipe(Effect.catch((error) => Effect.succeed({ failure: error instanceof DownloadFailed ? error.reason : "storage" }))));
            await WaveSoulseek.submitDecision(claim.id, claim.generation, claim.token, claim.decision, payload);
          } catch { /* The native lease expires and replays if JS or the bridge disappears. */ }
          finally { answering.delete(job.id); }
        })();
      }
    } while (refreshAgain);
  } finally { refreshing = false; }
};

/** The app and headless service attach the same responder; native snapshots replay missed events. */
export const startDownloads = (resume = false): void => {
  if (!attached) {
    attached = true;
    WaveSoulseek.addListener("onJobsChanged", () => { void refresh().catch(() => undefined); });
    setInterval(() => { void refresh().catch(() => undefined); }, 1_000);
  }
  void refresh().catch(() => undefined);
  if (resume) void WaveSoulseek.resumeJobs().catch(() => undefined);
};

let askedForNotifications = false;
const askForNotifications = (): void => {
  if (askedForNotifications || Platform.OS !== "android" || Number(Platform.Version) < 33) return;
  askedForNotifications = true;
  void PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS).catch(() => undefined);
};

let requests = Promise.resolve();
export const downloadYtSong = (song: NativeYtSong): void => {
  askForNotifications();
  startDownloads();
  // Serialize tap deduplication against the authoritative journal, using Core's identity decision.
  requests = requests.then(async () => {
    const jobs = await WaveSoulseek.jobsSnapshot();
    const equivalent = jobs.find((job) => job.phase !== "failed" && job.phase !== "cancelled" && !job.acknowledged && [job.song, ...(job.aliases ?? [])].every((existing) => soulseekSameRecording(existing, song)));
    await WaveSoulseek.enqueueJob(song, soulseekRecording(song), equivalent?.id ?? null);
    await refresh();
  }).catch(() => {
    downloads.update((state) => ({ jobs: [...state.jobs.filter((job) => job.song.videoId !== song.videoId), { song, status: { kind: "failed", reason: "storage" } }] }));
  });
};

export const cancelYtDownload = (videoId: string): void => {
  void WaveSoulseek.cancelJob(videoId).then(refresh).catch(() => undefined);
};
export const useYtDownloadStatus = (videoId: string): YtDownloadStatus | null =>
  useSyncExternalStore(downloads.subscribe, () => ytDownloadStatus(downloads.get(), videoId));

