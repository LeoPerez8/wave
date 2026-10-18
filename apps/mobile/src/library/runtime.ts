import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as ManagedRuntime from "effect/ManagedRuntime";
import { AppState } from "react-native";

import { whenFree } from "@/lib/backgroundWork";
import * as PlaybackPersistence from "@/playback/PlaybackPersistence";
import * as PlayHistory from "@/playback/PlayHistory";
import * as Player from "@/playback/Player";
import * as Queue from "@/playback/Queue";
import * as Stats from "@/stats/Stats";
import * as Auto from "@/auto/Auto";
import * as YtMusic from "@/ytmusic/YtMusic";
import * as WaveSync from "@/sync/WaveSync";

import {
  chooseExcludedFolder,
  chooseFolder,
  includeFolder,
  removeFolder,
  runFolderScan,
  runRescan,
  scanState,
  type ExclusionChoice,
  type FolderChoice,
} from "./LibraryScan";
import { clearArtistPhotos, downloadArtistPhotos, loadArtistPhotos } from "./artistPhotos";
import * as LibraryStore from "./LibraryStore";
import * as NativeScanner from "./NativeScanner";

/** Every app service, built once and shared by the whole app. */
const services = Layer.mergeAll(
  NativeScanner.layer,
  // The queue reads play counts for Smart Shuffle.
  Queue.layer.pipe(Layer.provideMerge(Player.layer)),
).pipe(Layer.provideMerge(LibraryStore.layer));

export const appLayer = Layer.mergeAll(
  PlaybackPersistence.layer,
  PlayHistory.layer,
  Stats.layer,
  Auto.layer,
  YtMusic.layer,
  WaveSync.layer,
).pipe(Layer.provideMerge(services));

export const appRuntime = ManagedRuntime.make(appLayer);

export type AppServices =
  LibraryStore.LibraryStore | NativeScanner.NativeScanner | Player.Player | Queue.Queue;

/** The scan running now, so a second request (pull to refresh) waits for it instead. */
let currentScan: Promise<void> | null = null;
let lastScanStartedAt = 0;

const startScan = (scan: Effect.Effect<unknown, never, AppServices>): Promise<void> => {
  if (currentScan !== null) return currentScan;
  lastScanStartedAt = Date.now();
  currentScan = appRuntime.runPromiseExit(scan).then((exit) => {
    currentScan = null;
    // New artists may have arrived; looking them up waits for the scan so it never competes with it.
    startArtistPhotoDownloads();
    // Scan failures are reported by the scan itself; this catches the services failing to start.
    if (Exit.isFailure(exit) && !Cause.hasInterruptsOnly(exit.cause)) {
      const error = Cause.squash(exit.cause);
      scanState.set({
        status: "failed",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });
  return currentScan;
};

/**
 * Runs [scan] once no other scan is running. Folder changes use this: the scan
 * running now (say, the rescan on returning from the folder picker) started
 * before the change and wouldn't include it.
 */
const startScanAfterCurrent = (scan: Effect.Effect<unknown, never, AppServices>): Promise<void> =>
  currentScan === null ? startScan(scan) : currentScan.then(() => startScanAfterCurrent(scan));

/** Coming back to Wave after this long rescans, so files copied meanwhile show up. */
const RESCAN_ON_RETURN_AFTER_MS = 60_000;
let rescanOnReturn: { remove: () => void } | null = null;

/** Rescans every music folder: incrementally, so only new, changed and removed files cost time. */
export const startRescan = (): Promise<void> => startScan(runRescan);

/**
 * Scans the library on launch (in full the first time, incrementally after)
 * and again whenever Wave comes back to the foreground a while later.
 * Safe to call repeatedly. Resolves once the launch scan is through.
 */
export const startInitialScan = (): Promise<void> => {
  // Cached artist photos show at once; new lookups wait for the scan.
  void appRuntime.runPromiseExit(loadArtistPhotos);
  const launchScan = startRescan();
  rescanOnReturn ??= AppState.addEventListener("change", (state) => {
    if (state === "active" && Date.now() - lastScanStartedAt >= RESCAN_ON_RETURN_AFTER_MS) {
      // Its first read (every indexed file) waits until the owner's first tap back is through.
      whenFree(() => void startRescan());
    }
  });
  return launchScan;
};

/** Opens the folder picker and, when a new folder is added, starts scanning it. */
export const chooseMusicFolder = async (): Promise<FolderChoice> => {
  const choice = await appRuntime.runPromise(chooseFolder);
  if (choice.kind === "added") void startScanAfterCurrent(runFolderScan(choice.path));
  return choice;
};

export const removeMusicFolder = (path: string): Promise<void> =>
  appRuntime.runPromise(removeFolder(path));

/** Opens the folder picker and, when the folder is excluded, rescans to drop its songs. */
export const chooseExcludedMusicFolder = async (): Promise<ExclusionChoice> => {
  const choice = await appRuntime.runPromise(chooseExcludedFolder);
  if (choice.kind === "added") void startScanAfterCurrent(runRescan);
  return choice;
};

/** Stops excluding a folder and rescans to bring its songs back. */
export const includeMusicFolder = async (path: string): Promise<void> => {
  await appRuntime.runPromise(includeFolder(path));
  void startScanAfterCurrent(runRescan);
};

/** The artist photo lookups running now, so they can be stopped. */
let photoDownloads: AbortController | null = null;
/** Asked to start while running: run once more when the current run ends. */
let photosAgain = false;

/**
 * Downloads the photos of artists that are due, in the background (see
 * `downloadArtistPhotos`); does nothing when Settings turned downloads off.
 * Safe to call repeatedly.
 */
export const startArtistPhotoDownloads = (): void => {
  if (photoDownloads !== null) {
    photosAgain = true;
    return;
  }
  const controller = new AbortController();
  photoDownloads = controller;
  void appRuntime.runPromiseExit(downloadArtistPhotos, { signal: controller.signal }).then(() => {
    if (photoDownloads !== controller) return;
    photoDownloads = null;
    if (photosAgain) {
      photosAgain = false;
      startArtistPhotoDownloads();
    }
  });
};

/** Stops every artist photo request at once (Settings turned downloads off). */
export const stopArtistPhotoDownloads = (): void => {
  photosAgain = false;
  photoDownloads?.abort();
  photoDownloads = null;
};

/** Deletes every downloaded artist photo; they're downloaded again later while downloads are on. */
export const clearArtistPhotoCache = (): Promise<void> => {
  stopArtistPhotoDownloads();
  return appRuntime.runPromise(clearArtistPhotos);
};
