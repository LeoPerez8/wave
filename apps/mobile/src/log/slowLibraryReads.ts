import type { SlowRead } from "@wave/core";

import { createLibraryReadTiming } from "./libraryReadTiming.ts";

const listeners = new Set<(read: SlowRead) => void>();

interface ReadLog {
  readonly route: () => string;
  readonly write: (line: string) => void;
}

// The log connects before the app starts. Keeping native imports on its side
// also lets desktop benches run the real store's read boundary unchanged.
let log: ReadLog | undefined;

/** Slow-screen timing can attach without putting its collector on fast reads. */
export const onSlowLibraryRead = (listener: (read: SlowRead) => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

/** Every build, including the headless Library store; independent of EXPO_PUBLIC_WAVE_PERF. */
const timing = createLibraryReadTiming({
  now: () => performance.now(),
  route: () => log?.route() ?? "/",
  write: (line) => log?.write(line),
  schedule: (flush, delay) => {
    const timer = setTimeout(flush, delay);
    return () => clearTimeout(timer);
  },
  onSlowRead: (read) => {
    for (const listener of listeners) listener(read);
  },
});

/** Connects the existing app-log writer and returns its forced-flush collector. */
export const connectLibraryReadLog = (sink: ReadLog): (() => void) => {
  log = sink;
  return timing.flush;
};

export const timeLibraryRead = timing.read;
