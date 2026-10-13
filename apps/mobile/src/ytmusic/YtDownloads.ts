/**
 * Downloading YT Music songs into the Library (docs/spec.md, "YT Music"):
 * the queue (Core's `stepYtDownloads`) and, for each song, the steps that
 * make it a Library track. Where the file goes and what it's tagged with are
 * Core's (`ytDownload.ts`); the native `WaveYtDownloads` fetches, tags and
 * moves the file. Downloads run in the background, one at a time, with a
 * notification, and the song is indexed the moment it's saved.
 */
import {
  YT_DOWNLOADS_NONE,
  stepYtDownloads,
  ytDownloadLookup,
  ytDownloadRoot,
  ytDownloadStatus,
  ytDownloadTags,
  ytDownloadTarget,
  ytDownloadsToStart,
  type FoundTags,
  type YtDownloadEvent,
  type YtDownloadFailure,
  type YtDownloadStatus,
  type YtDownloads,
} from "@wave/core";
import * as Cause from "effect/Cause";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import { useSyncExternalStore } from "react";
import { PermissionsAndroid, Platform } from "react-native";

import { libraryEdited, toIndexedArtwork, toIndexedTrack } from "@/library/LibraryScan";
import { LibraryStore } from "@/library/LibraryStore";
import { lookUpLyricsAndGenre } from "@/library/lyricsAndGenre";
import { appRuntime } from "@/library/runtime";
import { makeExternalStore } from "@/lib/externalStore";
import type { NativeYtSong } from "@/native/waveYtMusic";
import {
  WaveYtDownloads,
  ytDownloadErrorCode,
  type NativeYtAlbum,
  type NativeYtWatchSong,
} from "@/native/waveYtDownloads";

/** A download step that failed, and what the row says about it. */
class DownloadFailed extends Data.TaggedError("DownloadFailed")<{
  readonly reason: YtDownloadFailure;
  readonly cause?: unknown;
}> {}

const failure = (cause: unknown): DownloadFailed => {
  const code = ytDownloadErrorCode(cause);
  return new DownloadFailed({
    reason:
      code === "ERR_YT_OFFLINE" ? "offline" : code === "ERR_YT_STORAGE" ? "storage" : "failed",
    cause,
  });
};

const native = <A>(call: () => Promise<A>): Effect.Effect<A, DownloadFailed> =>
  Effect.tryPromise({ try: call, catch: failure });

/** Every download of this session; rows and menus read their song's from it. */
const downloads = makeExternalStore<YtDownloads<NativeYtSong>>(YT_DOWNLOADS_NONE);

/** The running downloads, by video id, so Cancel can stop them. */
const running = new Map<string, AbortController>();

const dispatch = (event: YtDownloadEvent<NativeYtSong>): void => {
  downloads.update((state) => stepYtDownloads(state, event));
  for (const song of ytDownloadsToStart(downloads.get())) start(song);
};

/** [song]'s album page: the one search linked, else the one its watch page names; null without one. */
const albumOf = (
  song: NativeYtSong,
  watch: () => Effect.Effect<NativeYtWatchSong, DownloadFailed>,
) =>
  Effect.gen(function* () {
    const albumId = song.albumId ?? (yield* watch()).albumId;
    if (albumId === null) return null;
    return yield* native<NativeYtAlbum>(() => WaveYtDownloads.album(albumId));
  });

/** Lyrics and genre found the way Find Lyrics and Genre finds them; null when off, unfound or failing. */
const lookUp = (
  song: NativeYtSong,
  album: NativeYtAlbum | null,
): Effect.Effect<FoundTags | null> => {
  const lookup = ytDownloadLookup(song, album);
  return lookup === null
    ? Effect.succeed(null)
    : lookUpLyricsAndGenre(lookup).pipe(Effect.orElseSucceed(() => null));
};

/** The steps that take [song] from YT Music into the Library; resolves the saved file's path. */
const downloadSong = (song: NativeYtSong) =>
  Effect.gen(function* () {
    const store = yield* LibraryStore;
    const roots = yield* store.listRoots.pipe(
      Effect.mapError((cause) => new DownloadFailed({ reason: "storage", cause })),
    );
    const root = ytDownloadRoot(roots);
    if (root === null) return yield* new DownloadFailed({ reason: "noFolder" });

    // The watch page is asked for at most once: for the album, then for YT Music's lyrics.
    let watchPage: NativeYtWatchSong | undefined;
    const watch = () =>
      watchPage === undefined
        ? native(() => WaveYtDownloads.watchSong(song.videoId)).pipe(
            Effect.tap((page) => Effect.sync(() => (watchPage = page))),
          )
        : Effect.succeed(watchPage);

    // Without its album page the song is still downloaded, filed and tagged as search saw it.
    const album = yield* albumOf(song, watch).pipe(
      Effect.catchTag("DownloadFailed", (error) =>
        error.reason === "offline" ? Effect.fail(error) : Effect.succeed(null),
      ),
    );
    const target = ytDownloadTarget(root, ytDownloadTags(song, album, null, null));

    // The audio downloads while lyrics and genre are looked up.
    const [audio, found] = yield* Effect.all(
      [
        native(() => WaveYtDownloads.downloadAudio(song.videoId, target.path, song.title)).pipe(
          Effect.onInterrupt(() => Effect.sync(() => WaveYtDownloads.cancelDownload(song.videoId))),
        ),
        lookUp(song, album),
      ],
      { concurrency: "unbounded" },
    );
    dispatch({ type: "saving", videoId: song.videoId });

    const ytLyrics =
      found !== null && found.lyrics !== null
        ? null
        : yield* watch().pipe(
            Effect.flatMap(({ lyricsBrowseId }) =>
              lyricsBrowseId === null
                ? Effect.succeed(null)
                : native(() => WaveYtDownloads.lyrics(lyricsBrowseId)),
            ),
            Effect.orElseSucceed(() => null),
          );
    const tags = ytDownloadTags(song, album, found, ytLyrics);
    const saved = yield* native(() =>
      WaveYtDownloads.saveDownload(
        song.videoId,
        audio.partPath,
        target.path,
        tags,
        tags.artworkUrl,
      ),
    ).pipe(Effect.uninterruptible);

    // In the Library (and out of YT Music's results) at once, without a rescan.
    yield* store
      .saveBatch(
        [toIndexedTrack(saved.track)],
        saved.artwork === null ? [] : [toIndexedArtwork(saved.artwork)],
      )
      .pipe(
        Effect.ensuring(Effect.sync(libraryEdited)),
        // The file is in the music folder; the next scan indexes it otherwise.
        Effect.ignore,
      );
    return saved.path;
  });

const start = (song: NativeYtSong): void => {
  const { videoId } = song;
  dispatch({ type: "started", videoId });
  const controller = new AbortController();
  running.set(videoId, controller);
  void appRuntime.runPromiseExit(downloadSong(song), { signal: controller.signal }).then((exit) => {
    if (running.get(videoId) === controller) running.delete(videoId);
    if (Exit.isSuccess(exit)) return dispatch({ type: "finished", videoId, path: exit.value });
    // Cancelled: the queue has already forgotten it.
    if (Cause.hasInterruptsOnly(exit.cause)) return;
    const error = Cause.squash(exit.cause);
    const reason = error instanceof DownloadFailed ? error.reason : "failed";
    console.warn(`[wave] download of ${videoId} failed (${reason})`, error);
    dispatch({ type: "failed", videoId, reason });
  });
};

/** Asked once, the first time: the download's notification needs it on Android 13 and later. */
let askedForNotifications = false;

const askForNotifications = (): void => {
  if (askedForNotifications || Platform.OS !== "android" || Number(Platform.Version) < 33) return;
  askedForNotifications = true;
  // Downloads go ahead either way; without it there's just no notification.
  void PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS).catch(
    () => undefined,
  );
};

let progressSubscribed = false;

const followProgress = (): void => {
  if (progressSubscribed) return;
  progressSubscribed = true;
  WaveYtDownloads.addListener("onDownloadProgress", ({ videoId, received, total }) =>
    dispatch({ type: "progress", videoId, received, total: total > 0 ? total : null }),
  );
};

/** Download (or Retry Download): queues [song]; it starts when nothing else downloads. */
export const downloadYtSong = (song: NativeYtSong): void => {
  askForNotifications();
  followProgress();
  dispatch({ type: "requested", song });
};

/** Cancel Download: forgets [videoId]'s download and stops it, leaving no file behind. */
export const cancelYtDownload = (videoId: string): void => {
  const status = ytDownloadStatus(downloads.get(), videoId);
  dispatch({ type: "cancelled", videoId });
  if (status?.kind === "downloading") running.get(videoId)?.abort();
};

/** Where [videoId]'s download is (null without one); re-renders as it moves on. */
export const useYtDownloadStatus = (videoId: string): YtDownloadStatus | null =>
  useSyncExternalStore(downloads.subscribe, () => ytDownloadStatus(downloads.get(), videoId));
