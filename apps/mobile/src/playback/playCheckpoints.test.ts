import assert from "node:assert/strict";
import { test } from "node:test";
import { makeExternalStore } from "../lib/externalStore.ts";
import { observePlayCheckpoints } from "./playCheckpoints.ts";

test("event-only playback still checkpoints every 15 seconds, and stops while paused or disposed", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 1_000 });
  const playback = makeExternalStore({ isPlaying: true });
  const saves: number[] = [];
  const stop = observePlayCheckpoints(playback, () => saves.push(Date.now()));
  t.mock.timers.tick(14_999);
  assert.deepEqual(saves, []);
  t.mock.timers.tick(1);
  assert.deepEqual(saves, [16_000]);
  // Metadata and seeks must not postpone the next checkpoint.
  playback.set({ isPlaying: true });
  t.mock.timers.tick(15_000);
  assert.deepEqual(saves, [16_000, 31_000]);
  playback.set({ isPlaying: false });
  t.mock.timers.tick(60_000);
  assert.equal(saves.length, 2);
  playback.set({ isPlaying: true });
  t.mock.timers.tick(15_000);
  assert.equal(saves.length, 3);
  stop();
  t.mock.timers.tick(30_000);
  assert.equal(saves.length, 3);
  assert.equal(playback.listenerCount(), 0);
});
