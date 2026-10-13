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
  type NativeDownloadedAudio,
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

/**
 * One run of a song's download. Cancel aborts it; whatever it does on the way
 * out (stopping the native transfer) checks it is still the song's current
 * attempt, so a late one can't touch a newer attempt for the same song.
 */
interface Attempt {
  readonly controller: AbortController;
}

/** The running downloads, by video id, so Cancel can stop them. */
const running = new Map<string, Attempt>();

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

/**
 * [videoId]'s audio, downloaded into a part file beside [targetPath]. [onArrived]
 * hears of the part file the moment it exists. Interrupted, it stops the native
 * transfer (when [attempt] is still the song's current one) and waits for it to
 * settle, so the next download never starts alongside it.
 */
const fetchAudio = (
  attempt: Attempt,
  videoId: string,
  targetPath: string,
  title: string,
  onArrived: (audio: NativeDownloadedAudio) => void,
) =>
  Effect.callback<NativeDownloadedAudio, DownloadFailed>((resume) => {
    const settled = WaveYtDownloads.downloadAudio(videoId, targetPath, title).then(
      (audio) => {
        onArrived(audio);
        resume(Effect.succeed(audio));
      },
      (cause: unknown) => resume(Effect.fail(failure(cause))),
    );
    return Effect.promise(() => {
      if (running.get(videoId) === attempt) WaveYtDownloads.cancelDownload(videoId);
      return settled;
    });
  });

/** Deletes a part file that won't be saved, and ends its notification. */
const discard = (videoId: string, audio: NativeDownloadedAudio) =>
  Effect.promise(() =>
    WaveYtDownloads.discardDownload(videoId, audio.partPath).catch((error: unknown) =>
      console.warn(`[wave] couldn't discard the download of ${videoId}`, error),
    ),
  );

/**
 * The steps that take [song] from YT Music into the Library; resolves the
 * saved file's path. Once the audio has arrived, any way out but saving it
 * (a failure, Cancel) discards the part file and ends its notification.
 */
const downloadSong = (song: NativeYtSong, attempt: Attempt) =>
  Effect.suspend(() => {
    // The part file while it's this download's to clean up: from its arrival until it's handed to `saveDownload`.
    let unsaved: NativeDownloadedAudio | null = null;
    return downloadSteps(song, attempt, {
      arrived: (audio) => (unsaved = audio),
      handedOver: () => (unsaved = null),
    }).pipe(Effect.onExit(() => (unsaved === null ? Effect.void : discard(song.videoId, unsaved))));
  });

const downloadSteps = (
  song: NativeYtSong,
  attempt: Attempt,
  part: {
    readonly arrived: (audio: NativeDownloadedAudio) => void;
    readonly handedOver: () => void;
  },
) =>
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
        fetchAudio(attempt, song.videoId, target.path, song.title, part.arrived),
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
    // From here the part file is `saveDownload`'s: it deletes it on failure and ends the notification.
    const saved = yield* native(() => {
      part.handedOver();
      return WaveYtDownloads.saveDownload(
        song.videoId,
        audio.partPath,
        target.path,
        tags,
        tags.artworkUrl,
      );
    }).pipe(Effect.uninterruptible);

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
  const attempt: Attempt = { controller: new AbortController() };
  running.set(videoId, attempt);
  const signal = attempt.controller.signal;
  void appRuntime.runPromiseExit(downloadSong(song, attempt), { signal }).then((exit) => {
    if (running.get(videoId) === attempt) running.delete(videoId);
    if (Exit.isSuccess(exit)) return dispatch({ type: "finished", videoId, path: exit.value });
    // Cancelled, and now stopped: the queue forgets it and moves on.
    if (Cause.hasInterruptsOnly(exit.cause)) return dispatch({ type: "cancelled", videoId });
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

/**
 * Cancel Download: stops [videoId]'s download, leaving no file behind, and
 * forgets it. A running one is forgotten once it has stopped (see `start`), so
 * the next song never downloads alongside it.
 */
export const cancelYtDownload = (videoId: string): void => {
  const status = ytDownloadStatus(downloads.get(), videoId);
  const attempt = running.get(videoId);
  if (status?.kind === "downloading" && attempt !== undefined) attempt.controller.abort();
  else dispatch({ type: "cancelled", videoId });
};

/** Where [videoId]'s download is (null without one); re-renders as it moves on. */
export const useYtDownloadStatus = (videoId: string): YtDownloadStatus | null =>
  useSyncExternalStore(downloads.subscribe, () => ytDownloadStatus(downloads.get(), videoId));
