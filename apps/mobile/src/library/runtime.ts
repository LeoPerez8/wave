import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as ManagedRuntime from "effect/ManagedRuntime";

import * as Player from "@/playback/Player";
import * as Queue from "@/playback/Queue";

import {
  chooseFolder,
  removeFolder,
  runFolderScan,
  runFullScan,
  runInitialScanIfNeeded,
  scanState,
  type FolderChoice,
} from "./LibraryScan";
import * as LibraryStore from "./LibraryStore";
import * as NativeScanner from "./NativeScanner";

/** Every app service, built once and shared by the whole app. */
export const appLayer = Layer.mergeAll(
  LibraryStore.layer,
  NativeScanner.layer,
  Queue.layer.pipe(Layer.provideMerge(Player.layer)),
);

export const appRuntime = ManagedRuntime.make(appLayer);

export type AppServices =
  | LibraryStore.LibraryStore
  | NativeScanner.NativeScanner
  | Player.Player
  | Queue.Queue;

const startScan = (scan: Effect.Effect<unknown, never, AppServices>): void => {
  if (scanState.get().status === "scanning") return;
  void appRuntime.runPromiseExit(scan).then((exit) => {
    // Scan failures are reported by the scan itself; this catches the services failing to start.
    if (Exit.isFailure(exit) && !Cause.hasInterruptsOnly(exit.cause)) {
      const error = Cause.squash(exit.cause);
      scanState.set({
        status: "failed",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });
};

/** Runs the first full scan if it hasn't completed yet. Safe to call repeatedly. */
export const startInitialScan = (): void => startScan(runInitialScanIfNeeded);

/** Scans the library again from scratch (used to retry after a failed scan). */
export const startFullScan = (): void => startScan(runFullScan);

/** Opens the folder picker and, when a new folder is added, starts scanning it. */
export const chooseMusicFolder = async (): Promise<FolderChoice> => {
  const choice = await appRuntime.runPromise(chooseFolder);
  if (choice.kind === "added") startScan(runFolderScan(choice.path));
  return choice;
};

export const removeMusicFolder = (path: string): Promise<void> =>
  appRuntime.runPromise(removeFolder(path));
