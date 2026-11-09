/// <reference types="node" />
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import * as Effect from "effect/Effect";

import type { SongMeasurement, SongToMeasure } from "../library/db/loudness.ts";
import type { AudioMeasurement } from "../native/audioMeasurement.ts";
import { createSongMeasurements } from "./songMeasurements.ts";

/** A promise for the meter's answer, settled by the test. */
interface Pending {
  readonly path: string;
  readonly answer: (measurement: AudioMeasurement) => void;
  readonly fail: (error: unknown) => void;
}

/**
 * A Library with the files [paths] (Track id = index + 1), none measured,
 * the queue window over all of them, and a meter that answers when told.
 */
const harness = (paths: readonly string[]) => {
  let on = true;
  let window = paths.map((_, index) => index + 1);
  const kept = new Map<number, SongMeasurement>();
  const changed = new Set<number>();
  const pending: Pending[] = [];
  const measured: string[] = [];
  const learned: number[] = [];
  let cancels = 0;
  const songs = (ids: readonly number[]): SongToMeasure[] =>
    ids.flatMap((id) => {
      const path = paths[id - 1];
      return path === undefined || kept.has(id) ? [] : [{ id, path, sizeBytes: 1, modifiedAt: 1 }];
    });
  const measurements = createSongMeasurements({
    on: () => on,
    wanted: () => window,
    songsToMeasure: (ids) => Effect.sync(() => songs(ids)),
    measure: (path) =>
      new Promise<AudioMeasurement>((resolve, reject) => {
        measured.push(path);
        pending.push({ path, answer: resolve, fail: reject });
      }),
    cancel: () => {
      cancels++;
      const running = pending.shift();
      running?.answer({ kind: "cancelled" });
    },
    save: (song, measurement) =>
      Effect.sync(() => {
        if (changed.has(song.id)) return false;
        kept.set(song.id, measurement);
        return true;
      }),
    learned: (id) => learned.push(id),
  });
  /** Lets the runner reach its next step. */
  const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
  return {
    measurements,
    changed,
    kept,
    measured,
    learned,
    settle,
    get cancels() {
      return cancels;
    },
    turn: (value: boolean) => {
      on = value;
      measurements.switched();
    },
    show: (ids: readonly number[]) => {
      window = [...ids];
    },
    /** The file at [id] changes before its measurement lands. */
    change: (id: number) => changed.add(id),
    /** Answers the measurement running, which must be of [path]. */
    answer: async (path: string, measurement: AudioMeasurement) => {
      await settle();
      const running = pending.shift();
      assert.equal(running?.path, path, "the file being measured");
      running.answer(measurement);
      await settle();
    },
    fail: async (path: string) => {
      await settle();
      const running = pending.shift();
      assert.equal(running?.path, path, "the file being measured");
      running.fail(new Error("bridge"));
      await settle();
    },
    idle: async () => {
      await settle();
      assert.equal(pending.length, 0, "nothing being measured");
    },
  };
};

const loud = { kind: "measured", loudness: -8, peak: 1 } as const;

describe("createSongMeasurements", () => {
  test("measures the window's songs one at a time, in order, keeping each result", async () => {
    const h = harness(["/a.mp3", "/b.flac", "/c.ogg"]);
    void h.measurements.wake();
    await h.settle();
    assert.deepEqual(h.measured, ["/a.mp3"]);
    await h.answer("/a.mp3", loud);
    assert.deepEqual(h.measured, ["/a.mp3", "/b.flac"]);
    await h.answer("/b.flac", { kind: "measured", loudness: -20, peak: 0.5 });
    await h.answer("/c.ogg", loud);
    await h.idle();
    assert.deepEqual(
      [...h.kept],
      [
        [1, { loudness: -8, peak: 1 }],
        [2, { loudness: -20, peak: 0.5 }],
        [3, { loudness: -8, peak: 1 }],
      ],
    );
    assert.deepEqual(h.learned, [1, 2, 3]);
  });

  test("a queue change while a song is measured takes effect after it", async () => {
    const h = harness(["/a.mp3", "/b.flac", "/c.ogg", "/d.wav"]);
    void h.measurements.wake();
    h.show([4, 3]);
    void h.measurements.wake();
    await h.answer("/a.mp3", loud);
    await h.answer("/d.wav", loud);
    await h.answer("/c.ogg", loud);
    await h.idle();
    assert.deepEqual(h.measured, ["/a.mp3", "/d.wav", "/c.ogg"]);
  });

  test("a file that can't be decoded is kept as unmeasurable and not tried again", async () => {
    const h = harness(["/broken.m4a", "/b.flac"]);
    void h.measurements.wake();
    await h.answer("/broken.m4a", { kind: "unmeasurable" });
    await h.answer("/b.flac", loud);
    await h.idle();
    assert.deepEqual(
      [...h.kept],
      [
        [1, null],
        [2, { loudness: -8, peak: 1 }],
      ],
    );
    // No value: the player keeps the typical gain for it.
    assert.deepEqual(h.learned, [2]);
    await h.measurements.wake();
    assert.deepEqual(h.measured, ["/broken.m4a", "/b.flac"]);
  });

  test("a file that can't be read now is left for the next launch, not kept as unmeasurable", async () => {
    const h = harness(["/sd/gone.mp3", "/b.flac", "/c.ogg"]);
    void h.measurements.wake();
    await h.answer("/sd/gone.mp3", { kind: "unreadable" });
    await h.answer("/b.flac", loud);
    await h.fail("/c.ogg");
    await h.idle();
    assert.deepEqual([...h.kept], [[2, { loudness: -8, peak: 1 }]]);
    await h.measurements.wake();
    assert.deepEqual(h.measured, ["/sd/gone.mp3", "/b.flac", "/c.ogg"]);
  });

  test("a result for a file that changed while it was measured isn't learned, and the file is measured again", async () => {
    const h = harness(["/a.mp3"]);
    void h.measurements.wake();
    h.change(1);
    await h.answer("/a.mp3", loud);
    assert.deepEqual(h.learned, []);
    h.changed.delete(1);
    await h.answer("/a.mp3", loud);
    await h.idle();
    assert.deepEqual(h.learned, [1]);
  });

  test("measures nothing while Normalize Volume is off", async () => {
    const h = harness(["/a.mp3"]);
    h.turn(false);
    await h.measurements.wake();
    assert.deepEqual(h.measured, []);
  });

  test("turning it off stops the song being measured and keeps nothing; on again, measuring picks up there", async () => {
    const h = harness(["/a.mp3", "/b.flac"]);
    void h.measurements.wake();
    await h.settle();
    h.turn(false);
    await h.idle();
    assert.equal(h.cancels, 1);
    assert.deepEqual(h.kept, new Map());
    h.turn(true);
    await h.answer("/a.mp3", loud);
    await h.answer("/b.flac", loud);
    await h.idle();
    assert.deepEqual(h.measured, ["/a.mp3", "/a.mp3", "/b.flac"]);
    assert.deepEqual([...h.kept.keys()], [1, 2]);
  });
});
