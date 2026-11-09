/**
 * Normalize Volume's measurements of the rest of the Library (docs/spec.md,
 * "Normalize Volume"): a native job measures the Library files without a
 * value while the phone charges, with Wave closed too, and keeps what it
 * measured until the app takes it in, as the Library store is the schema's
 * only owner. This hands the job the files to measure ([refresh]: at start
 * and after the Library changes) and takes in what it measured ([take]: at
 * start and as it measures): kept in the store, it's forgotten by the job,
 * and each song plays at its value from its next start ([learned]). A result
 * the store can't keep now stays with the job for the next time. Kept free of
 * Expo so it runs under plain Node tests.
 */
import type { LibraryChange } from "@wave/core";
import * as Effect from "effect/Effect";

import type { MeasuredSong, SongToMeasure } from "../library/db/loudness.ts";
import type { LibraryMeasurement } from "../native/audioMeasurement.ts";

export interface LibraryMeasurementsDeps {
  /** Every Library file to measure, oldest first (`LibraryStore.libraryToMeasure`). */
  readonly toMeasure: Effect.Effect<readonly SongToMeasure[], unknown>;
  /** Gives the job [songs] to measure in place of its list (`WaveNative.setLibraryToMeasure`). */
  readonly hand: (songs: readonly SongToMeasure[]) => Promise<void>;
  /** The first [limit] results the job keeps (`WaveNative.libraryMeasurements`). */
  readonly results: (limit: number) => Promise<readonly LibraryMeasurement[]>;
  /** Keeps [measured] in the Library store; the Track ids kept (`LibraryStore.saveMeasurements`). */
  readonly save: (measured: readonly MeasuredSong[]) => Effect.Effect<readonly number[], unknown>;
  /** The job forgets its results through [seq] (`WaveNative.forgetLibraryMeasurements`). */
  readonly forget: (seq: number) => Promise<void>;
  /** Library songs [ids] have a value of their own now. */
  readonly learned: (ids: readonly number[]) => void;
}

/** The job's results kept per store write: one transaction each. */
export const TAKE_AT_ONCE = 200;

/** The job keeps a result per file: those of the next seconds are taken in together. */
export const MEASURED_SETTLE_MS = 3_000;

/**
 * Library changes come in bursts (a scan's batches): the job gets its list once
 * none has come for this long, so a long scan reads it once, at its end.
 */
export const CHANGES_SETTLE_MS = 5_000;

const sameSongs = (a: readonly SongToMeasure[], b: readonly SongToMeasure[]): boolean =>
  a.length === b.length &&
  a.every((song, index) => {
    const other = b[index];
    return (
      other !== undefined &&
      song.id === other.id &&
      song.path === other.path &&
      song.sizeBytes === other.sizeBytes &&
      song.modifiedAt === other.modifiedAt
    );
  });

/** What a result says to keep; null for a file the job couldn't open, which stays to measure. */
const toMeasured = (result: LibraryMeasurement): MeasuredSong | null => {
  if (result.kind === "unreadable") return null;
  const { id, path, sizeBytes, modifiedAt } = result;
  return {
    song: { id, path, sizeBytes, modifiedAt },
    measurement:
      result.kind === "measured" ? { loudness: result.loudness, peak: result.peak } : null,
  };
};

export const createLibraryMeasurements = (deps: LibraryMeasurementsDeps) => {
  // The list the job was last handed in this run of JS.
  let handed: readonly SongToMeasure[] | null = null;
  let wantTake = false;
  let wantRefresh = false;
  let running: Promise<void> | null = null;

  const take = Effect.gen(function* () {
    for (;;) {
      const results = yield* Effect.tryPromise(() => deps.results(TAKE_AT_ONCE));
      if (results.length === 0) return;
      const measured = results.flatMap((result) => toMeasured(result) ?? []);
      const kept = new Set(measured.length === 0 ? [] : yield* deps.save(measured));
      const valued = measured.flatMap(({ song, measurement }) =>
        measurement !== null && kept.has(song.id) ? [song.id] : [],
      );
      if (valued.length > 0) deps.learned(valued);
      const through = results.reduce((last, result) => Math.max(last, result.seq), 0);
      yield* Effect.tryPromise(() => deps.forget(through));
      if (results.length < TAKE_AT_ONCE) return;
    }
  });

  const refresh = Effect.gen(function* () {
    const songs = yield* deps.toMeasure;
    if (handed !== null && sameSongs(handed, songs)) return;
    yield* Effect.tryPromise(() => deps.hand(songs));
    handed = songs;
  });

  // What's taken in goes first: the list read after it leaves those songs out.
  const pass = Effect.gen(function* () {
    while (wantTake || wantRefresh) {
      if (wantTake) {
        wantTake = false;
        yield* Effect.exit(take);
      } else {
        wantRefresh = false;
        yield* Effect.exit(refresh);
      }
    }
  });

  /** Runs what's asked for, from the next microtask, so asks in one turn go together. */
  const wake = (): Promise<void> => {
    running ??= Promise.resolve()
      .then(() => Effect.runPromise(pass))
      .finally(() => {
        running = null;
        if (wantTake || wantRefresh) void wake();
      });
    return running;
  };

  const takeNow = (): Promise<void> => {
    wantTake = true;
    return wake();
  };
  const refreshNow = (): Promise<void> => {
    wantRefresh = true;
    return wake();
  };

  let takeTimer: ReturnType<typeof setTimeout> | null = null;
  let refreshTimer: ReturnType<typeof setTimeout> | null = null;

  return {
    /** Takes in what the job measured; resolves once it's done (a pass running included). */
    take: takeNow,
    /** Hands the job the Library's files to measure now, unless it has that list already. */
    refresh: refreshNow,
    /** The job kept a result (`onLibraryMeasured`): it's taken in with those that follow it. */
    measured: (): void => {
      takeTimer ??= setTimeout(() => {
        takeTimer = null;
        void takeNow();
      }, MEASURED_SETTLE_MS);
    },
    /** The Library changed: a scan that added or changed files gives the job a new list. */
    changed: (change: LibraryChange): void => {
      if (change.kind !== "tracks") return;
      if (refreshTimer !== null) clearTimeout(refreshTimer);
      refreshTimer = setTimeout(() => {
        refreshTimer = null;
        void refreshNow();
      }, CHANGES_SETTLE_MS);
    },
    /** Drops what was due (the queue's scope closed). */
    stop: (): void => {
      if (takeTimer !== null) clearTimeout(takeTimer);
      if (refreshTimer !== null) clearTimeout(refreshTimer);
      takeTimer = null;
      refreshTimer = null;
    },
  };
};
