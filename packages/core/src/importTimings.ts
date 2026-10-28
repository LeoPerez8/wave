/**
 * How long a From YT Music or From Spotify playlist's import spent in each
 * phase (#759), for one line in the app log once its songs are in: waiting
 * its turn in the batch, reading its source, listing and indexing the
 * Library (or taking the index another playlist's import built),
 * matching its songs, starring them, and adding them.
 */

import { counted } from "./listening.ts";

/** An import's phases, in the order they run. */
export type ImportPhase =
  | "waiting"
  | "reading"
  | "listing"
  | "indexing"
  /**
   * Taking the Library's index another playlist's import built, or waiting
   * for it while that one builds it (a Try Again read joining the batch's):
   * the listing and indexing are booked on that one's timer.
   */
  | "joining"
  | "matching"
  | "starring"
  | "adding";

/** Milliseconds spent in each phase an import went through. */
export type ImportPhaseTimings = Readonly<Partial<Record<ImportPhase, number>>>;

/** Times an import's phases on one clock. */
export interface ImportPhaseTimer {
  /** Ends a stretch of [phase]: the time since the last mark (or the start) goes to it. */
  readonly mark: (phase: ImportPhase) => void;
  /** What each phase took so far. */
  readonly timings: () => ImportPhaseTimings;
}

const PHASES: readonly ImportPhase[] = [
  "waiting",
  "reading",
  "listing",
  "indexing",
  "joining",
  "matching",
  "starring",
  "adding",
];

const PHASE_WORDS: Readonly<Record<ImportPhase, string>> = {
  waiting: "waited",
  reading: "read",
  listing: "listed the Library",
  indexing: "indexed the Library",
  joining: "waited for the Library's index",
  matching: "matched",
  starring: "starred",
  adding: "added",
};

/** A timer whose first phase started at [startedAt] (the moment the playlist was queued). */
export const importPhaseTimer = (
  now: () => number,
  startedAt: number = now(),
): ImportPhaseTimer => {
  const spent: Partial<Record<ImportPhase, number>> = {};
  let last = startedAt;
  return {
    mark: (phase) => {
      const at = now();
      spent[phase] = (spent[phase] ?? 0) + Math.max(0, at - last);
      last = at;
    },
    timings: () => ({ ...spent }),
  };
};

/** [ms] in seconds, to a tenth. */
const seconds = (ms: number): string =>
  `${(Math.round(ms / 100) / 10).toLocaleString("en", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  })} s`;

/**
 * The app log's line for [name]'s import of [songs] songs: each phase it went
 * through, in order, then the whole. Song titles never appear.
 */
export const importTimingsLogLine = (
  name: string,
  songs: number,
  timings: ImportPhaseTimings,
): string => {
  let total = 0;
  const parts: string[] = [];
  for (const phase of PHASES) {
    const ms = timings[phase];
    if (ms === undefined) continue;
    total += ms;
    parts.push(`${PHASE_WORDS[phase]} ${seconds(ms)}`);
  }
  return `Import of "${name}" (${counted(songs, "song")}) phases: ${parts.join(", ")}; ${seconds(total)} in all`;
};
