/**
 * Files opened with Wave: "Open with", a double-click, or paths on the command line. The system
 * starts Wave once per file when several are opened together, so the files of launches that
 * come close together are gathered and played as one queue (docs/spec-desktop.md, Opening files).
 */
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { openedAudioFiles } from "@wave/core";

import { PLAYABLE_EXTENSIONS } from "../../shared/playback.ts";

/**
 * The audio files a launch names, as absolute paths: the arguments of [argv] with an extension
 * the engine plays, relative ones read from the launch's working directory [cwd].
 */
export const launchFiles = (argv: readonly string[], cwd: string): string[] =>
  openedAudioFiles(argv.slice(1), PLAYABLE_EXTENSIONS).flatMap((path) => {
    // A Linux desktop entry hands a file over as a `file:` address.
    if (!path.startsWith("file:")) return [resolve(cwd, path)];
    try {
      return [fileURLToPath(path)];
    } catch {
      return [];
    }
  });

/** How long Wave waits for another launch's files before it plays the ones it has. */
export const OPENED_FILES_QUIET_MS = 500;

export interface OpenedFiles {
  /** A launch named these files. */
  readonly opened: (paths: readonly string[]) => void;
  /** Wave's services are up: files can play. */
  readonly ready: () => void;
}

export const createOpenedFiles = (deps: {
  /** Plays the files as a new queue. */
  readonly play: (paths: readonly string[]) => void;
  readonly quietMs?: number;
  /** Runs [run] after [ms]; the returned function cancels it. */
  readonly after?: (ms: number, run: () => void) => () => void;
}): OpenedFiles => {
  const after =
    deps.after ??
    ((ms, run) => {
      const timer = setTimeout(run, ms);
      return () => clearTimeout(timer);
    });
  let waiting: string[] = [];
  let ready = false;
  let cancel: (() => void) | undefined;
  const wait = () => {
    cancel?.();
    cancel = undefined;
    if (!ready || waiting.length === 0) return;
    cancel = after(deps.quietMs ?? OPENED_FILES_QUIET_MS, () => {
      cancel = undefined;
      const paths = waiting;
      waiting = [];
      deps.play(paths);
    });
  };
  return {
    opened: (paths) => {
      if (paths.length === 0) return;
      waiting.push(...paths);
      wait();
    },
    ready: () => {
      ready = true;
      wait();
    },
  };
};
