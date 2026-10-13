/** The existing Download menu/row backed by automatic Soulseek acquisition. */
import {
  YT_DOWNLOADS_NONE,
  isWithin,
  soulseekCandidates,
  soulseekReceivedMatches,
  soulseekRecording,
  stepYtDownloads,
  ytDownloadDestination,
  ytDownloadLookup,
  ytDownloadStatus,
  ytDownloadTags,
  ytDownloadsToStart,
  type FoundTags,
  type YtDownloadEvent,
  type YtDownloadFailure,
  type YtDownloadPhase,
  type YtDownloadStatus,
  type YtDownloads,
} from "@wave/core";
import * as Cause from "effect/Cause";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Result from "effect/Result";
import { useSyncExternalStore } from "react";
import { PermissionsAndroid, Platform } from "react-native";

import { libraryEdited, toIndexedArtwork, toIndexedTrack } from "@/library/LibraryScan";
import { LibraryStore } from "@/library/LibraryStore";
import { lookUpLyricsAndGenre } from "@/library/lyricsAndGenre";
import { appRuntime } from "@/library/runtime";
import { makeExternalStore } from "@/lib/externalStore";
import { WaveSoulseek, soulseekErrorCode, type NativeSoulseekAudio } from "@/native/waveSoulseek";
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
interface Attempt {
  readonly controller: AbortController;
}
const running = new Map<string, Attempt>();
/** #115 replaces this with a durable outbox. Retry DB import without fetching another file. */
const pendingImports = new Map<string, NativeSavedDownload>();
const dispatch = (event: YtDownloadEvent<NativeYtSong>): void => {
  downloads.update((state) => stepYtDownloads(state, event));
  for (const song of ytDownloadsToStart(downloads.get())) start(song);
};

const fetchAudio = (
  song: NativeYtSong,
  attempt: Attempt,
  plan: Effect.Success<ReturnType<typeof prepareSoulseekDownload>>,
  arrived: (audio: NativeSoulseekAudio) => void,
) =>
  Effect.gen(function* () {
    for (const candidate of plan.candidates) {
      dispatch({ type: "phase", videoId: song.videoId, phase: "transferring" });
      const result = yield* Effect.result(
        Effect.callback<NativeSoulseekAudio, DownloadFailed>((resume) => {
          const settled = WaveSoulseek.downloadAudio(
            song.videoId,
            candidate,
            plan.target.path,
            song.title,
            song.durationMs ?? candidate.durationMs ?? 0,
          ).then(
            (audio) => {
              arrived(audio);
              resume(Effect.succeed(audio));
            },
            (cause: unknown) => resume(Effect.fail(failure(cause))),
          );
          return Effect.promise(() => {
            if (running.get(song.videoId) === attempt) WaveSoulseek.cancelDownload(song.videoId);
            return settled;
          });
        }),
      );
      if (Result.isFailure(result)) {
        if (
          result.failure.reason === "offline" ||
          result.failure.reason === "account" ||
          result.failure.reason === "storage"
        )
          return yield* result.failure;
        continue;
      }
      dispatch({ type: "phase", videoId: song.videoId, phase: "validating" });
      if (soulseekReceivedMatches(song, result.success.receivedTags, result.success.durationMs))
        return result.success;
      yield* discard(song.videoId, result.success);
    }
    return yield* new DownloadFailed({ reason: "unavailable" });
  });
const discard = (videoId: string, audio: NativeSoulseekAudio) =>
  Effect.promise(() =>
    WaveYtDownloads.discardDownload(videoId, audio.partPath).catch(() => undefined),
  );

const downloadSong = (song: NativeYtSong, attempt: Attempt) =>
  Effect.suspend(() => {
    let unsaved: NativeSoulseekAudio | null = null;
    return Effect.gen(function* () {
      const pending = pendingImports.get(song.videoId);
      if (pending !== undefined) {
        dispatch({ type: "saving", videoId: song.videoId });
        const path = yield* importSoulseekDownload(pending);
        pendingImports.delete(song.videoId);
        return path;
      }
      const plan = yield* prepareSoulseekDownload(song, (phase) =>
        dispatch({ type: "phase", videoId: song.videoId, phase }),
      );
      const audio = yield* fetchAudio(song, attempt, plan, (part) => {
        unsaved = part;
      });
      if (!(yield* downloadPathIncluded(plan.target.path)))
        return yield* new DownloadFailed({ reason: "noFolder" });
      dispatch({ type: "saving", videoId: song.videoId });
      const saved = yield* native(() => {
        unsaved = null;
        return WaveYtDownloads.saveDownload(
          song.videoId,
          audio.partPath,
          plan.target.path,
          plan.tags,
          plan.tags.artworkUrl,
        );
      }).pipe(Effect.uninterruptible);
      pendingImports.set(song.videoId, saved);
      const path = yield* importSoulseekDownload(saved);
      pendingImports.delete(song.videoId);
      return path;
    }).pipe(Effect.onExit(() => (unsaved === null ? Effect.void : discard(song.videoId, unsaved))));
  });
const start = (song: NativeYtSong): void => {
  const { videoId } = song;
  dispatch({ type: "started", videoId });
  const attempt: Attempt = { controller: new AbortController() };
  running.set(videoId, attempt);
  void appRuntime
    .runPromiseExit(downloadSong(song, attempt), { signal: attempt.controller.signal })
    .then((exit) => {
      if (running.get(videoId) === attempt) running.delete(videoId);
      if (Exit.isSuccess(exit)) return dispatch({ type: "finished", videoId, path: exit.value });
      if (Cause.hasInterruptsOnly(exit.cause)) return dispatch({ type: "cancelled", videoId });
      const error = Cause.squash(exit.cause);
      dispatch({
        type: "failed",
        videoId,
        reason: error instanceof DownloadFailed ? error.reason : "failed",
      });
    });
};
let askedForNotifications = false;
const askForNotifications = (): void => {
  if (askedForNotifications || Platform.OS !== "android" || Number(Platform.Version) < 33) return;
  askedForNotifications = true;
  void PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS).catch(
    () => undefined,
  );
};
let progressSubscribed = false;
const followProgress = (): void => {
  if (progressSubscribed) return;
  progressSubscribed = true;
  WaveSoulseek.addListener("onDownloadProgress", ({ videoId, phase, received, total }) =>
    dispatch(
      phase === "queued"
        ? { type: "phase", videoId, phase: "queued" }
        : { type: "progress", videoId, received, total: total > 0 ? total : null },
    ),
  );
};
export const downloadYtSong = (song: NativeYtSong): void => {
  askForNotifications();
  followProgress();
  dispatch({ type: "requested", song });
};
export const cancelYtDownload = (videoId: string): void => {
  const state = downloads.get();
  const job = state.jobs.find(
    (item) =>
      item.song.videoId === videoId || item.relatedSongs?.some((song) => song.videoId === videoId),
  );
  const owner = job?.song.videoId ?? videoId;
  const attempt = running.get(owner);
  if (job?.status.kind === "downloading" && attempt !== undefined) attempt.controller.abort();
  else dispatch({ type: "cancelled", videoId: owner });
};
export const useYtDownloadStatus = (videoId: string): YtDownloadStatus | null =>
  useSyncExternalStore(downloads.subscribe, () => ytDownloadStatus(downloads.get(), videoId));
