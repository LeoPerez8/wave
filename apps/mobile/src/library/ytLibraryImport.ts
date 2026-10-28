import { registerTimingBackground, timingBackgroundChanged } from "@/lib/timing";
/**
 * From YT Music's and From Spotify's Import (docs/spec.md, "Importing
 * playlists from a link"; one batch and one set of origins for both, a
 * Spotify source told apart by Core's `isSpotifyLibrarySource`):
 * each ticked playlist becomes a Wave playlist at once, empty and named by
 * Core (`planYtLibraryImport`: Keep Both's name on a clash, without asking).
 * Wave then reads them one at a time, in the picker's order, and fills each
 * as a YouTube Music link import does (`readYtPlaylist`, `planLinkImport`,
 * `finishPlaylistImport`), Liked Songs whole and the others up to the cap.
 * Nothing is searched; there's no notification and no service. Import &
 * Download keeps that choice on each playlist it made (Core's
 * `YtLibraryRead.download`), so once one is read and filled its downloads
 * are queued as its Download Playlist would queue them; a read that failed
 * loses it, so Try Again imports without downloading.
 * The batch is kept on the phone (Core's `writeYtLibraryBatch`), so the
 * playlists not read when Android stopped Wave are read once it starts again,
 * in the same order. Offline or with YT Music off the batch pauses, every
 * playlist still waiting, and goes on when Wave starts again, comes back to
 * the foreground or imports again. A read that fails otherwise leaves its
 * playlist empty, with a line and Try Again on its page. With Also add to Favorites on, Liked Songs'
 * read stars its songs the Library has (Core's `ytLibraryFavorites`), kept
 * in the batch so a resumed read or Try Again still stars; the others are
 * kept as pending favorites, each starred once a download or scan brings
 * it in, and their downloads join the queue under Favorites as any star's do
 * (Import & Download queues them as the playlist's instead). The star syncs
 * like any other, and the import never takes one away.
 *
 * Each playlist's origin (the YouTube Music playlist it came from) is kept
 * on this phone, unsynced: the picker marks those rows Imported, and ticking
 * one refreshes that playlist as Replace does. Deleting it forgets it.
 */
import {
  importLibraryIndexSteps,
  importPhaseTimer,
  importTimingsLogLine,
  isSpotifyLibrarySource,
  isYtLibraryReadQueued,
  liveYtLibraryOrigins,
  nextYtLibraryRead,
  planLinkImportWithIndexSteps,
  planYtLibraryImport,
  pruneYtLibraryBatch,
  readSpotifyAccountPlaylist,
  queueYtLibraryReads,
  readingProgress,
  readYtLibraryOrigins,
  writeYtLibraryOrigins,
  MATCHING_PROGRESS,
  ytLibraryFavoritesSteps,
  ytLibraryPauseLogLine,
  ytLibraryDownloadsQueued,
  ytLibraryDownloadsToQueue,
  ytLibraryReadDone,
  ytLibraryReadFailed,
  ytLibraryReadLogLine,
  ytLibraryReadView,
  type ImportLibraryIndex,
  type ImportPhaseTimer,
  type LinkedSource,
  type YtLibraryBatch,
  type YtLibraryOrigins,
  type YtLibraryPicker,
  type YtLibraryRead,
  playlistDownloadOrigin,
} from "@wave/core";
import { startupTurn, startupTurnEffect } from "@/lib/backgroundWork";
import { runSteps } from "@/lib/stepped";
import { resumeLibraryReads } from "./libraryImportResume";
import { dispatchLibraryFavorites, readImportDownloadInput } from "./startupJobs";

import * as Result from "effect/Result";
import { useSyncExternalStore } from "react";
import { AppState } from "react-native";

import { makeExternalStore } from "@/lib/externalStore";
import { persistedSetting } from "@/lib/persistedSetting";
import { appLog } from "@/log/appLog";
import type { NativeYtSong } from "@/native/waveYtMusic";
import { askSpotifyAccount } from "@/spotify/askSpotify";
import { askYtMusic } from "@/ytmusic/askYtMusic";
import { downloadStarredSongs, runYtPlaylistDownloadAction } from "@/ytmusic/YtDownloads";

import { setFavorites, setPendingFavorites } from "./favorites";
import { makeImportIndexCache } from "./importIndexCache";
import { endImportProgress, showImportProgress } from "./importProgress";
import { libraryVersion } from "./LibraryScan";
import { LibraryStore } from "./LibraryStore";
import { listLibrary } from "./playlistImports";
import { cancelPlaylistImport, settlePlaylistImport, startLinkImport } from "./playlistImports";
import { createPlaylist, currentPlaylists, replacePlaylistSongs } from "./playlists";
import { appRuntime } from "./runtime";
import { downloadSyncedStars } from "./starSongs";
import { ytLibraryBatch } from "./ytLibraryBatchStore";

const LOG_TAG = "WaveImport";

/** Which YouTube Music playlist each playlist From YT Music made came from (this phone only). */
const origins = persistedSetting<YtLibraryOrigins>({
  key: "ytLibraryOrigins",
  read: readYtLibraryOrigins,
  write: (value) => (value.size === 0 ? null : writeYtLibraryOrigins(value)),
});

/**
 * The origins of the playlists that still exist, for the picker; those of
 * playlists deleted (here or on another phone) are forgotten. Should the
 * playlists not read, the kept ones stand: Import checks them again.
 */
export const currentYtLibraryOrigins = async (): Promise<YtLibraryOrigins> => {
  const playlists = await currentPlaylists().catch(() => null);
  if (playlists === null) return origins.get();
  const live = liveYtLibraryOrigins(origins.get(), playlists);
  if (live.size !== origins.get().size) origins.set(live);
  return live;
};

/** After a delete: the deleted playlists forget where they came from. */
export const forgetDeletedYtLibraryOrigins = async (): Promise<void> => {
  if (origins.get().size > 0) await currentYtLibraryOrigins();
};

/** The playlists still to be read, and those whose read failed; phone-local, never synced. */
const batch = ytLibraryBatch;

/** The batch, for a playlist page's line. */
export const useYtLibraryBatch = (): YtLibraryBatch => batch.useValue();

/** The playlists Try Again is reading now. */
const readingAgain = makeExternalStore<ReadonlySet<number>>(new Set());

/** Whether Try Again is reading [playlistId] now. */
export const useReadingAgain = (playlistId: number): boolean =>
  useSyncExternalStore(readingAgain.subscribe, () => readingAgain.get().has(playlistId));

/** Whether the batch is reading its playlists now. */
let reading = false;
registerTimingBackground("libraryImport", () =>
  reading || readingAgain.get().size > 0 ? "import" : null,
);
readingAgain.subscribe(timingBackgroundChanged);

/**
 * Import & Download, once [playlistId] is filled: its downloads join the
 * queue as its Download Playlist would queue them, the songs the Library
 * doesn't have, in playlist order. A playlist deleted meanwhile queues nothing.
 */
const downloadPlaylist = async (read: YtLibraryRead): Promise<void> => {
  // oxlint-disable-next-line react/rules-of-hooks -- Effect Service.use resolves a service; it is not a React Hook.
  const preparing = LibraryStore.use((store) =>
    readImportDownloadInput(store, read.playlistId, startupTurnEffect, () =>
      isYtLibraryReadQueued(batch.get(), read),
    ),
  );
  const prepared = await appRuntime.runPromise(preparing);
  if (prepared === null) return;
  const { detail, inLibrary } = prepared;
  runYtPlaylistDownloadAction(
    "downloadPlaylist",
    detail.items,
    inLibrary,
    playlistDownloadOrigin(detail.playlist),
  );
};

/**
 * Queues filled [read]'s downloads (`downloadPlaylist`), then lets it leave
 * the batch: until then it's kept, so Wave stopping in between still queues
 * them as the batch resumes (Core's `ytLibraryDownloadsToQueue`).
 */
const queueDownloads = async (read: YtLibraryRead): Promise<void> => {
  await downloadPlaylist(read).catch((error: unknown) => {
    const why = error instanceof Error ? error.message : String(error);
    appLog("warn", LOG_TAG, `Import of "${read.name}" couldn't queue its downloads: ${why}`);
  });
  batch.set(ytLibraryDownloadsQueued(batch.get(), read));
};

type SourceRead =
  | { readonly ok: true; readonly source: LinkedSource<NativeYtSong> }
  | { readonly ok: false; readonly reason: string };

/**
 * [read]'s playlist as its service gives it: a From Spotify read as the
 * signed-in Spotify account, whole (Core's `readSpotifyAccountPlaylist`),
 * any other from YouTube Music, up to the cap unless it's Liked Songs.
 */
const readSource = async (read: YtLibraryRead): Promise<SourceRead> => {
  // Each page moves its playlist's "Reading N of M", while the read is still the batch's.
  const readSoFar = (done: number, total: number | null): void => {
    if (isYtLibraryReadQueued(batch.get(), read))
      showImportProgress(read.playlistId, readingProgress(read, done, total));
  };
  readSoFar(0, null);
  if (isSpotifyLibrarySource(read.source)) {
    const answer = await readSpotifyAccountPlaylist(
      read.source,
      async (request) => {
        await startupTurn();
        return askSpotifyAccount((spotify) =>
          request.kind === "likedSongs"
            ? spotify.likedSongs(request.offset)
            : spotify.playlist(request.uri, request.offset),
        );
      },
      readSoFar,
    );
    if (!answer.ok) return answer;
    // Typed whole, not narrowed to Spotify's side, so the plan's songs are YT Music's as the app reads them.
    const source: LinkedSource<NativeYtSong> = { service: "spotify", playlist: answer.playlist };
    return { ok: true, source };
  }
  const answer = await askYtMusic((ytMusic) =>
    ytMusic.playlist(read.source, {
      uncapped: !read.capped,
      // Rows read, a video listed again included, as the source counts them.
      onPage: (playlist) => readSoFar(playlist.songs.length + playlist.repeats.length, null),
    }),
  );
  return Result.isSuccess(answer)
    ? { ok: true, source: { service: "ytMusic", playlist: answer.success } }
    : { ok: false, reason: answer.failure.reason };
};

/** The Library indexed for matching, shared by the playlists read while it stays as it was. */
const libraryIndex = makeImportIndexCache<ImportLibraryIndex>(() => libraryVersion.get());

/** Lists and indexes the Library on free turns, timing each as [timer]'s phase. */
const buildLibraryIndex = async (timer: ImportPhaseTimer): Promise<ImportLibraryIndex> => {
  const library = await listLibrary();
  timer.mark("listing");
  return appRuntime.runPromise(runSteps(importLibraryIndexSteps(library), startupTurnEffect));
};

/** Once no import reads, the index (the whole Library's keys) goes. */
const dropIdleLibraryIndex = (): void => {
  if (!reading && readingAgain.get().size === 0) libraryIndex.clear();
};

/** When each playlist was queued this run, for its waiting time in the log. */
const queuedAt = new Map<number, number>();
/** When the batch started reading this time: a playlist queued before Wave started waited from then. */
let readingSince: number | null = null;

/**
 * Reads [read]'s playlist and gives its Wave playlist the songs, as a link
 * import does (whose line goes to the app log), starring the Library's songs
 * when it was asked to. A read whose playlist was refreshed or deleted
 * meanwhile gives its answer to nothing (Core's `isYtLibraryReadQueued`).
 * Offline, with YT Music off or signed out of Spotify, nothing changes and
 * it resolves the reason: the batch pauses there. Any other failure leaves the playlist empty, marks
 * it failed and says so in the log.
 */
const fill = async (read: YtLibraryRead): Promise<string | null> => {
  let reason: string;
  // Each phase's time goes to the app log once the songs are in (#759).
  const timer = importPhaseTimer(
    () => performance.now(),
    queuedAt.get(read.playlistId) ?? readingSince ?? performance.now(),
  );
  try {
    await startupTurn();
    // A deletion/refresh while waiting for a turn must not send the stale source request.
    if (!isYtLibraryReadQueued(batch.get(), read)) return null;
    timer.mark("waiting");
    const answer = await readSource(read);
    if (answer.ok) {
      if (!isYtLibraryReadQueued(batch.get(), read)) return null;
      timer.mark("reading");
      showImportProgress(read.playlistId, MATCHING_PROGRESS);
      await startupTurn();
      // Listed and indexed once for the playlists after it, while the Library stays as it was.
      const index = await libraryIndex.current(() => buildLibraryIndex(timer));
      timer.mark("indexing");
      const plan = await appRuntime.runPromise(
        runSteps(planLinkImportWithIndexSteps(answer.source, index), startupTurnEffect),
      );
      if (!isYtLibraryReadQueued(batch.get(), read)) return null;
      timer.mark("matching");
      // Before it leaves the batch: Wave stopped in between stars again, which changes nothing.
      const favorites = await appRuntime.runPromise(
        runSteps(ytLibraryFavoritesSteps(read, plan), startupTurnEffect),
      );
      await startupTurn();
      if (!isYtLibraryReadQueued(batch.get(), read)) return null;
      // The pending favorites' stars then ask for their downloads, under Favorites (a star
      // means downloaded).
      const dispatched = await dispatchLibraryFavorites(favorites, {
        turn: startupTurn,
        current: () => isYtLibraryReadQueued(batch.get(), read),
        star: (ids) => setFavorites(ids, true),
        syncedStars: () => void downloadSyncedStars(),
        pend: (pending) => setPendingFavorites(pending, true),
        download: (songs) => downloadStarredSongs(songs),
      });
      if (!dispatched) return null;
      // Checked again with no wait before the link import starts: a refresh from here on
      // empties the playlist and ends that import.
      if (!isYtLibraryReadQueued(batch.get(), read)) return null;
      timer.mark("starring");
      // Read: the link import, kept on its own, gives it its songs from here. Import &
      // Download's read stays, filled, until its downloads are queued.
      batch.set(ytLibraryReadDone(batch.get(), read));
      queuedAt.delete(read.playlistId);
      await startLinkImport(plan, { playlistId: read.playlistId, name: read.name });
      timer.mark("adding");
      appLog("info", LOG_TAG, importTimingsLogLine(read.name, plan.songs.length, timer.timings()));
      if (read.download) await queueDownloads(read);
      return null;
    }
    reason = answer.reason;
  } catch (error) {
    reason = error instanceof Error ? error.message : String(error);
  }
  const failure = ytLibraryReadFailed(batch.get(), read, reason);
  if (failure.pause) return reason;
  if (isYtLibraryReadQueued(batch.get(), read)) {
    appLog("warn", LOG_TAG, ytLibraryReadLogLine(read, reason));
    // Its page says "Couldn't read it online" instead.
    endImportProgress(read.playlistId);
  }
  if (!failure.pause) queuedAt.delete(read.playlistId);
  batch.set(failure.batch);
  return null;
};

/**
 * Drops the playlists deleted meanwhile, here or on another phone. A batch
 * that changed while the playlists were read (an Import queued one made
 * since) is left for the next turn.
 */
const prune = async (): Promise<void> => {
  const before = batch.get();
  const playlists = await currentPlaylists();
  const pruned = pruneYtLibraryBatch(
    before,
    playlists.map((playlist) => playlist.id),
  );
  if (batch.get() === before) batch.set(pruned);
};

/**
 * Reads the waiting playlists one at a time, in order, until none is left,
 * or until a read finds Wave offline or YT Music off: the batch then waits
 * for its next turn (Wave starting again, coming back to the foreground, or
 * another Import). The playlists deleted are dropped once, as it starts; one
 * deleted while it runs is read, and its link import ends at once. First, the
 * playlists Import & Download filled before Wave stopped queue their downloads.
 */
const readBatch = async (): Promise<void> => {
  const left = batch.get();
  if (reading) return;
  if (nextYtLibraryRead(left) === undefined && ytLibraryDownloadsToQueue(left).length === 0) return;
  reading = true;
  readingSince = performance.now();
  timingBackgroundChanged();
  try {
    await resumeLibraryReads({
      turn: startupTurn,
      batch: batch.get,
      prune,
      settle: settlePlaylistImport,
      download: queueDownloads,
      fill,
      paused: (read, reason) => appLog("info", LOG_TAG, ytLibraryPauseLogLine(read, reason)),
    });
  } catch (error) {
    const why = error instanceof Error ? error.message : String(error);
    appLog("warn", LOG_TAG, `The YouTube Music import's batch stopped: ${why}`);
  } finally {
    reading = false;
    readingSince = null;
    dropIdleLibraryIndex();
  }
};

/**
 * The playlist an earlier import made, emptied for a fresh copy as Replace
 * empties it. A link import still filling it would add its songs to the new
 * ones, so it ends.
 */
const emptyPlaylist = async (
  playlistId: number,
  name: string,
): Promise<{ readonly playlistId: number; readonly name: string }> => {
  cancelPlaylistImport(playlistId);
  await replacePlaylistSongs(playlistId, []);
  return { playlistId, name };
};

/**
 * Import in the From YT Music picker: makes a playlist of each ticked row
 * now, in its order, or empties the one an earlier import made, each kept in
 * the batch as it's made, then reads them in the background. Import &
 * Download ([download]) also queues each one's downloads once it's read.
 * Resolves once the playlists exist.
 */
export const importYtLibrary = async (
  picker: YtLibraryPicker,
  { download }: { readonly download: boolean },
): Promise<void> => {
  try {
    await makeYtLibraryPlaylists(picker, download);
  } finally {
    // The playlists queued before one that couldn't be made are read all the same.
    void readBatch();
  }
};

/** Makes or empties each ticked row's playlist, in order, queuing each as it's made. */
const makeYtLibraryPlaylists = async (
  picker: YtLibraryPicker,
  download: boolean,
): Promise<void> => {
  const items = planYtLibraryImport(picker, await currentPlaylists());
  for (const item of items) {
    const made =
      item.replaces === null
        ? await createPlaylist(item.name)
        : await emptyPlaylist(item.replaces, item.name);
    // A refreshed playlist starts again from Waiting.
    endImportProgress(made.playlistId);
    queuedAt.set(made.playlistId, performance.now());
    batch.set(
      queueYtLibraryReads(batch.get(), [
        {
          source: item.playlistId,
          playlistId: made.playlistId,
          name: made.name,
          capped: !item.uncapped,
          favorites: item.favorites,
          download,
          expected: item.expected,
        },
      ]),
    );
    origins.set(new Map(origins.get()).set(item.playlistId, made.playlistId));
  }
};

/** Whether the batch goes on each time Wave comes back to the foreground. */
let followingForeground = false;

/**
 * Once Wave starts with all-files access: the playlists a batch hadn't read
 * when Android stopped Wave, or when it paused offline or with YT Music off,
 * are read, in the same order, and again each time Wave comes back to the
 * foreground. Safe to call repeatedly.
 */
export const resumeYtLibraryImport = (): void => {
  if (!followingForeground) {
    followingForeground = true;
    AppState.addEventListener("change", (state) => {
      if (state === "active") void readBatch();
    });
  }
  void readBatch();
};

/**
 * Try Again on [playlistId]'s page: reads it again now and fills it as the
 * batch would have; a failure leaves the line as it was.
 */
export const readYtLibraryPlaylistAgain = async (playlistId: number): Promise<void> => {
  const view = ytLibraryReadView(batch.get(), playlistId);
  if (view === null || readingAgain.get().has(playlistId)) return;
  readingAgain.set(new Set([...readingAgain.get(), playlistId]));
  try {
    // Offline or with YT Music off the line stays, and the log says why.
    const pausedBy = await fill(view.read);
    if (pausedBy !== null) appLog("warn", LOG_TAG, ytLibraryReadLogLine(view.read, pausedBy));
  } finally {
    readingAgain.set(new Set([...readingAgain.get()].filter((id) => id !== playlistId)));
    dropIdleLibraryIndex();
  }
};
