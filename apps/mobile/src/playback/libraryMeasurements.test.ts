/// <reference types="node" />
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import * as Effect from "effect/Effect";

import type { MeasuredSong, SongToMeasure } from "../library/db/loudness.ts";
import type { LibraryMeasurement } from "../native/audioMeasurement.ts";
import {
  CHANGES_SETTLE_MS,
  createLibraryMeasurements,
  MEASURED_SETTLE_MS,
  TAKE_AT_ONCE,
} from "./libraryMeasurements.ts";

const song = (id: number, sizeBytes = 1): SongToMeasure => ({
  id,
  path: `/Music/${id}.flac`,
  sizeBytes,
  modifiedAt: 1,
});

/**
 * A Library whose files without a value are [library]'s, and a charging job
 * that kept [results] (with their place in its results), as the app finds them.
 */
const harness = (library: SongToMeasure[], results: LibraryMeasurement[] = []) => {
  const state = {
    library,
    results,
    handed: [] as (readonly SongToMeasure[])[],
    saved: [] as MeasuredSong[],
    learned: [] as number[],
    reads: [] as string[],
    failSave: false,
    failResults: false,
  };
  const measurements = createLibraryMeasurements({
    toMeasure: Effect.sync(() => {
      state.reads.push("library");
      return [...state.library];
    }),
    hand: async (songs) => {
      state.handed.push(songs);
    },
    results: async (limit) => {
      state.reads.push("results");
      if (state.failResults) throw new Error("bridge");
      return state.results.slice(0, limit);
    },
    save: (measured) =>
      state.failSave
        ? Effect.fail("disk full")
        : Effect.sync(() => {
            state.saved.push(...measured);
            const kept = new Set(state.library.map((file) => JSON.stringify(file)));
            const ids = measured.flatMap(({ song: file }) =>
              kept.has(JSON.stringify(file)) ? [file.id] : [],
            );
            state.library = state.library.filter((file) => !ids.includes(file.id));
            return ids;
          }),
    forget: async (through) => {
      state.results = state.results.filter((result) => result.seq > through);
    },
    learned: (ids) => {
      state.learned.push(...ids);
    },
  });
  return { state, measurements };
};

const measured = (seq: number, file: SongToMeasure, loudness = -10): LibraryMeasurement => ({
  seq,
  ...file,
  kind: "measured",
  loudness,
  peak: 0.9,
});

describe("libraryMeasurements", () => {
  test("keeps what the job measured in the Library store, then the job forgets it", async () => {
    const [a, b, c] = [song(1), song(2), song(3)];
    const { state, measurements } = harness(
      [a!, b!, c!],
      [
        measured(1, a!, -8),
        { seq: 2, ...b!, kind: "unmeasurable" },
        { seq: 3, ...c!, kind: "unreadable" },
      ],
    );
    await measurements.take();
    assert.deepEqual(state.saved, [
      { song: a, measurement: { loudness: -8, peak: 0.9 } },
      { song: b, measurement: null },
    ]);
    // The song with a value plays at it from its next start; the file the job couldn't open
    // stays to measure.
    assert.deepEqual(state.learned, [1]);
    assert.deepEqual(state.results, []);
    assert.deepEqual(state.library, [c]);
  });

  test("takes a long run's results in a batch at a time", async () => {
    const library = Array.from({ length: TAKE_AT_ONCE * 2 + 5 }, (_, index) => song(index + 1));
    const { state, measurements } = harness(
      library,
      library.map((file, index) => measured(index + 1, file)),
    );
    await measurements.take();
    assert.equal(state.reads.filter((read) => read === "results").length, 3);
    assert.equal(state.learned.length, library.length);
    assert.deepEqual(state.results, []);
  });

  test("what the job measured of a file that changed since is dropped, and the job forgets it", async () => {
    const before = song(1);
    const { state, measurements } = harness([song(1, 2)], [measured(1, before)]);
    await measurements.take();
    assert.deepEqual(state.learned, []);
    assert.deepEqual(state.results, []);
    assert.deepEqual(state.library, [song(1, 2)]);
  });

  test("results the store couldn't keep stay with the job for the next time", async () => {
    const a = song(1);
    const { state, measurements } = harness([a], [measured(7, a)]);
    state.failSave = true;
    await measurements.take();
    assert.equal(state.results.length, 1);
    state.failSave = false;
    await measurements.take();
    assert.deepEqual(state.learned, [1]);
    assert.deepEqual(state.results, []);
  });

  test("a job that can't answer now is asked again next time", async () => {
    const a = song(1);
    const { state, measurements } = harness([a], [measured(1, a)]);
    state.failResults = true;
    await measurements.take();
    state.failResults = false;
    await measurements.take();
    assert.deepEqual(state.learned, [1]);
  });

  test("hands the job the Library's files to measure, again only when they changed", async () => {
    const { state, measurements } = harness([song(1), song(2)]);
    await measurements.refresh();
    await measurements.refresh();
    assert.deepEqual(state.handed, [[song(1), song(2)]]);
    // A scan changed a file and added one.
    state.library = [song(1), song(2, 5), song(3)];
    await measurements.refresh();
    assert.deepEqual(state.handed.at(-1), [song(1), song(2, 5), song(3)]);
    // A finished Library leaves the job nothing.
    state.library = [];
    await measurements.refresh();
    assert.deepEqual(state.handed.at(-1), []);
  });

  test("what's taken in is kept before the list is read, so the job isn't handed it again", async () => {
    const [a, b] = [song(1), song(2)];
    const { state, measurements } = harness([a!, b!], [measured(1, a!)]);
    const refreshed = measurements.refresh();
    const taken = measurements.take();
    await Promise.all([refreshed, taken]);
    assert.deepEqual(state.reads, ["results", "library"]);
    assert.deepEqual(state.handed, [[b]]);
  });

  test("takes in what the job keeps a moment after it says so, together", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const [a, b] = [song(1), song(2)];
    const { state, measurements } = harness([a!, b!]);
    state.results = [measured(1, a!)];
    measurements.measured();
    state.results.push(measured(2, b!));
    measurements.measured();
    t.mock.timers.tick(MEASURED_SETTLE_MS - 1);
    await settled();
    assert.deepEqual(state.reads, []);
    t.mock.timers.tick(1);
    await settled();
    assert.deepEqual(state.reads, ["results"]);
    assert.deepEqual(state.learned, [1, 2]);
  });

  test("hands the job a new list once the Library's tracks stop changing", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const { state, measurements } = harness([song(1)]);
    // A long scan's batches: the list is read once, after the last.
    for (let batch = 0; batch < 5; batch++) {
      measurements.changed({ kind: "tracks", ids: [1], burst: true });
      measurements.changed({ kind: "favorites", ids: [1] });
      t.mock.timers.tick(CHANGES_SETTLE_MS - 1);
      await settled();
    }
    assert.deepEqual(state.reads, []);
    t.mock.timers.tick(1);
    await settled();
    assert.deepEqual(state.handed, [[song(1)]]);
    // Only the tracks' changes are about files.
    measurements.changed({ kind: "playlists" });
    t.mock.timers.tick(CHANGES_SETTLE_MS);
    await settled();
    assert.deepEqual(state.reads, ["library"]);
  });

  test("stopping drops what was due", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const { state, measurements } = harness([song(1)]);
    measurements.measured();
    measurements.changed({ kind: "tracks" });
    measurements.stop();
    t.mock.timers.tick(CHANGES_SETTLE_MS);
    await settled();
    assert.deepEqual(state.reads, []);
  });
});

/** Lets the promises a timer started settle. */
const settled = async () => {
  for (let turn = 0; turn < 20; turn++) await Promise.resolve();
};
