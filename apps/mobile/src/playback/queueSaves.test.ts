import assert from "node:assert/strict";
import { test } from "node:test";
import type { QueueWrite } from "@wave/core";
import { makeExternalStore } from "../lib/externalStore.ts";
import { observeQueueSaves } from "./queueSaves.ts";

const setup = (isPlaying: boolean) => {
  const playback = makeExternalStore({ isPlaying });
  const settled = makeExternalStore<QueueWrite | null>(null);
  let positionMs = 0;
  const positions: number[] = [];
  const writes: QueueWrite[] = [];
  const saves = observeQueueSaves({
    playback,
    settled,
    positionMs: () => positionMs,
    saveQueue: (write) => writes.push(write),
    savePosition: (at) => positions.push(at),
  });
  return {
    playback,
    settled,
    saves,
    positions,
    writes,
    moveTo: (at: number) => {
      positionMs = at;
    },
  };
};

test("steady play saves the position about every 5 seconds with no playback events", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 0 });
  const { saves, positions, moveTo, playback } = setup(true);
  saves.start();
  moveTo(5_000);
  t.mock.timers.tick(5_000);
  moveTo(10_000);
  t.mock.timers.tick(5_000);
  assert.deepEqual(positions, [5_000, 10_000]);
  // Pausing saves where it stopped, and nothing more is saved while paused.
  moveTo(12_000);
  playback.set({ isPlaying: false });
  t.mock.timers.tick(60_000);
  assert.deepEqual(positions, [5_000, 10_000, 12_000]);
  saves.stop();
  assert.equal(playback.listenerCount(), 0);
});

test("nothing is saved before saving starts (the restore is still running)", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 0 });
  const { saves, positions, writes, settled } = setup(true);
  settled.set({ index: 2 });
  t.mock.timers.tick(30_000);
  assert.deepEqual(positions, []);
  assert.deepEqual(writes, []);
  saves.stop();
});

test("a write dropped before saving starts goes with the next one", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 0 });
  const { saves, writes, settled, moveTo } = setup(false);
  settled.set({ queue: "[a,b,c]", metadata: "{}", index: 0, positionMs: 0 });
  saves.start();
  moveTo(3_000);
  settled.set({ index: 1 });
  assert.deepEqual(writes, [{ queue: "[a,b,c]", metadata: "{}", index: 1, positionMs: 3_000 }]);
  settled.set({ index: 2 });
  assert.deepEqual(writes[1], { index: 2, positionMs: 3_000 });
  saves.stop();
});
