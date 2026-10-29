import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  YT_THROTTLE_START,
  ytThrottleNotice,
  ytThrottleRead,
  ytThrottleRefused,
  ytThrottleRestored,
  ytThrottleSucceeded,
} from "./index.ts";
import type { YtThrottle } from "./index.ts";

const MIN = 60_000;

/** [songs] refused one after another, a second apart from [at]. */
const refuse = (state: YtThrottle, songs: readonly string[], at: number): YtThrottle =>
  songs.reduce((next, song, i) => ytThrottleRefused(next, song, at + i * 1_000), state);

const afterSuccess = ytThrottleSucceeded(YT_THROTTLE_START);

/** A YouTube job as the journal reports it, with its marks. */
const job = (id: string, marks: { refusedAt?: number; servedAt?: number }) => ({ id, ...marks });

describe("ytThrottle", () => {
  test("five different songs refused within a minute after a success pause YouTube for 2 minutes", () => {
    const state = refuse(afterSuccess, ["a", "b", "c", "d", "e"], 10_000);
    assert.equal(state.pausedUntil, 14_000 + 2 * MIN);
  });

  test("four songs, or one song refused five times, are not a burst", () => {
    assert.equal(refuse(afterSuccess, ["a", "b", "c", "d"], 0).pausedUntil, null);
    assert.equal(refuse(afterSuccess, ["a", "a", "a", "a", "a"], 0).pausedUntil, null);
  });

  test("refusals more than a minute apart are not a burst", () => {
    const state = refuse(afterSuccess, ["a", "b", "c", "d"], 0);
    assert.equal(ytThrottleRefused(state, "e", 61_000).pausedUntil, null);
  });

  test("refusals before any download worked are the songs', not a limit", () => {
    assert.equal(refuse(YT_THROTTLE_START, ["a", "b", "c", "d", "e"], 0).pausedUntil, null);
  });

  test("each burst after a pause doubles the pause, up to 30 minutes", () => {
    let state = afterSuccess;
    const pauses: number[] = [];
    let at = 0;
    for (let i = 0; i < 6; i++) {
      state = refuse(state, ["a", "b", "c", "d", "e"], at);
      assert.notEqual(state.pausedUntil, null);
      pauses.push((state.pausedUntil ?? 0) - (at + 4_000));
      at = state.pausedUntil ?? 0;
    }
    assert.deepEqual(
      pauses,
      [2, 4, 8, 16, 30, 30].map((m) => m * MIN),
    );
  });

  test("refusals while paused change nothing", () => {
    const paused = refuse(afterSuccess, ["a", "b", "c", "d", "e"], 0);
    assert.deepEqual(refuse(paused, ["f", "g", "h", "i", "j"], 10_000), paused);
  });

  test("a download that works starts the backoff over", () => {
    const paused = refuse(afterSuccess, ["a", "b", "c", "d", "e"], 0);
    const after = ytThrottleSucceeded(paused);
    const again = refuse(after, ["a", "b", "c", "d", "e"], (paused.pausedUntil ?? 0) + 2_000);
    assert.equal((again.pausedUntil ?? 0) - ((paused.pausedUntil ?? 0) + 6_000), 2 * MIN);
  });
});

describe("ytThrottleRead", () => {
  test("reads the journal's refusals and served streams in time order, each once", () => {
    const served = ytThrottleRead(YT_THROTTLE_START, [job("x", { servedAt: 1_000 })]);
    const jobs = ["a", "b", "c", "d", "e"].map((id, i) => job(id, { refusedAt: 10_000 + i }));
    const paused = ytThrottleRead(served, jobs);
    assert.equal(paused.pausedUntil, 10_004 + 2 * MIN);
    // Read again, the same marks are old news.
    assert.deepEqual(ytThrottleRead(paused, jobs), paused);
  });

  test("a stream served after the refusals, read in the same pass, comes after them", () => {
    const jobs = [
      job("x", { servedAt: 20_000 }),
      ...["a", "b", "c", "d"].map((id, i) => job(id, { refusedAt: 10_000 + i })),
    ];
    const state = ytThrottleRead(ytThrottleSucceeded(YT_THROTTLE_START), jobs);
    assert.equal(ytThrottleRefused(state, "e", 21_000).pausedUntil, null);
  });

  test("marks from before what was read last are ignored", () => {
    const start = { ...afterSuccess, readUpTo: 50_000 };
    const jobs = ["a", "b", "c", "d", "e"].map((id, i) => job(id, { refusedAt: 10_000 + i }));
    assert.equal(ytThrottleRead(start, jobs).pausedUntil, null);
  });
});

describe("ytThrottleRestored", () => {
  test("Wave restarting mid-pause keeps the pause and its backoff, and reads only what comes next", () => {
    const state = ytThrottleRestored({ until: 5 * MIN, level: 2 }, 3 * MIN, []);
    assert.equal(state.pausedUntil, 5 * MIN);
    const jobs = ["a", "b", "c", "d", "e"].map((id, i) => ({ id, refusedAt: 6 * MIN + i }));
    assert.equal(ytThrottleRead(state, jobs).pausedUntil, 6 * MIN + 4 + 8 * MIN);
    const old = ["a", "b", "c", "d", "e"].map((id, i) => ({ id, refusedAt: MIN + i }));
    assert.deepEqual(ytThrottleRead(state, old), state);
  });

  test("with no pause kept, it starts afresh from now", () => {
    assert.deepEqual(ytThrottleRestored(null, 7, []), { ...YT_THROTTLE_START, readUpTo: 7 });
  });

  test("a pause over before the restart still keeps its backoff: the next burst pauses longer", () => {
    // Paused at level 2 until minute 5; Wave starts again at minute 20, YouTube still limiting.
    const state = ytThrottleRestored({ until: 5 * MIN, level: 2 }, 20 * MIN, []);
    assert.equal(ytThrottleNotice(state.pausedUntil, 20 * MIN), null);
    const jobs = ["a", "b", "c", "d", "e"].map((id, i) => ({ id, refusedAt: 21 * MIN + i }));
    assert.equal(ytThrottleRead(state, jobs).pausedUntil, 21 * MIN + 4 + 8 * MIN);
  });

  test("a stream the journal shows served before the restart means downloads had worked", () => {
    const jobs = [job("x", { servedAt: 2 * MIN })];
    const state = ytThrottleRestored(null, 10 * MIN, jobs);
    assert.equal(state.succeeded, true);
    const burst = ["a", "b", "c", "d", "e"].map((id, i) => job(id, { refusedAt: 11 * MIN + i }));
    assert.equal(ytThrottleRead(state, burst).pausedUntil, 11 * MIN + 4 + 2 * MIN);
    assert.equal(
      ytThrottleRestored(null, 10 * MIN, [job("y", { refusedAt: MIN })]).succeeded,
      false,
    );
  });
});

describe("ytThrottleNotice", () => {
  test("while paused, says YouTube is limiting downloads and when the next try comes", () => {
    assert.equal(
      ytThrottleNotice(10 * MIN, 6 * MIN + 10_000),
      "Paused: YouTube is limiting downloads. Next try in 4 min",
    );
    assert.equal(
      ytThrottleNotice(10 * MIN, 10 * MIN - 20_000),
      "Paused: YouTube is limiting downloads. Next try in 1 min",
    );
  });

  test("says nothing when downloads aren't paused", () => {
    assert.equal(ytThrottleNotice(null, 0), null);
    assert.equal(ytThrottleNotice(10 * MIN, 10 * MIN), null);
  });
});

describe("ytThrottleNotice in Portuguese", () => {
  test("says the pause and the next try in Portuguese", () => {
    assert.equal(
      ytThrottleNotice(10 * MIN, 6 * MIN + 10_000, "pt-BR"),
      "Pausado: o YouTube está limitando os downloads. Próxima tentativa em 4 min",
    );
  });
});
