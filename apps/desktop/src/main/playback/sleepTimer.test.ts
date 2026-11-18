import assert from "node:assert/strict";
import { test } from "node:test";

import { createSleepTimer } from "./sleepTimer.ts";

/** A clock the test moves, with the timers it holds. */
const host = () => {
  let now = Date.UTC(2026, 9, 11, 22, 0);
  let pending: { at: number; run: () => void } | undefined;
  const log: string[] = [];
  const timer = createSleepTimer({
    now: () => now,
    pause: async () => void log.push("pause"),
    pauseAtTrackEnd: async (on) => void log.push(`hold ${on}`),
    schedule: (ms, run) => {
      pending = { at: now + ms, run };
      return () => (pending = undefined);
    },
  });
  return {
    timer,
    log,
    /** Moves the clock by [ms]; a check due by then runs, as late as [late] ms. */
    pass: async (ms: number, late = 0) => {
      now += ms;
      if (pending !== undefined && pending.at + late <= now) {
        const { run } = pending;
        pending = undefined;
        run();
        await timer.settled();
      }
    },
    scheduled: () => pending !== undefined,
  };
};

test("a 30-minute timer pauses playback at its deadline and ends", async () => {
  const { timer, log, pass } = host();
  await timer.set({ type: "minutes", minutes: 30 });
  assert.equal(timer.current()?.type, "deadline");
  await pass(29 * 60_000);
  assert.deepEqual(log, []);
  await pass(60_000);
  assert.deepEqual(log, ["pause"]);
  assert.equal(timer.current(), null);
});

test("cancelling the timer stops its check without pausing", async () => {
  const { timer, log, pass, scheduled } = host();
  await timer.set({ type: "minutes", minutes: 15 });
  await timer.set(null);
  assert.equal(scheduled(), false);
  await pass(20 * 60_000);
  assert.deepEqual(log, []);
});

test("End of track holds the next song back until the track ends, then lets it go", async () => {
  const { timer, log } = host();
  await timer.set({ type: "endOfTrack" });
  assert.deepEqual(log, ["hold true"]);
  await timer.stopped("trackEnd");
  assert.deepEqual(log, ["hold true", "hold false"]);
  assert.equal(timer.current(), null);
});

test("choosing another timer over End of track lets the next song play again", async () => {
  const { timer, log } = host();
  await timer.set({ type: "endOfTrack" });
  await timer.set({ type: "endOfQueue" });
  assert.deepEqual(log, ["hold true", "hold false"]);
  await timer.stopped("trackEnd");
  assert.equal(timer.current()?.type, "endOfQueue");
  await timer.stopped("queueEnd");
  assert.deepEqual(log, ["hold true", "hold false", "pause"]);
  assert.equal(timer.current(), null);
});

test("playing again after a deadline passed unheard ends the timer and keeps playing", async () => {
  const { timer, log, pass } = host();
  await timer.set({ type: "minutes", minutes: 1 });
  // The computer slept: its check is held back past the deadline.
  await pass(2 * 60_000, 10 * 60_000);
  await timer.resumed();
  assert.equal(timer.current(), null);
  assert.deepEqual(log, []);
});
