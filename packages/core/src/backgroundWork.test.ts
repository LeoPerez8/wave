import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { createBackgroundWork, type BackgroundWorkLimits } from "./index.ts";

const LIMITS: BackgroundWorkLimits = {
  quietMs: 400,
  maxWaitMs: 2000,
  takeoverMs: 3000,
  contentCapMs: 3000,
};

/** Background work on a virtual clock; `ran` lists what ran, with when. */
const setup = (limits: Partial<BackgroundWorkLimits> = {}) => {
  let time = 0;
  const timers: { at: number; run: () => void; cancelled: boolean }[] = [];
  const ran: string[] = [];
  const work = createBackgroundWork({
    now: () => time,
    schedule: (ms, run) => {
      const timer = { at: time + ms, run, cancelled: false };
      timers.push(timer);
      return () => {
        timer.cancelled = true;
      };
    },
    limits: { ...LIMITS, ...limits },
  });
  /** Moves the clock on by [ms], running the timers that fall due, in order. */
  const advance = (ms: number): void => {
    const end = time + ms;
    for (;;) {
      const due = timers
        .filter((timer) => !timer.cancelled && timer.at <= end)
        .toSorted((a, b) => a.at - b.at)[0];
      if (due === undefined) break;
      due.cancelled = true;
      time = Math.max(time, due.at);
      due.run();
    }
    time = end;
  };
  const note = (name: string) => () => ran.push(`${name}@${time}`);
  return { work, advance, ran, note, at: () => time };
};

describe("background work yields to interaction", () => {
  test("work asked while nothing goes on runs on the next turn, not inside the caller", () => {
    const { work, advance, ran, note } = setup();
    work.whenFree(note("scan"));
    assert.deepEqual(ran, []);
    advance(0);
    assert.deepEqual(ran, ["scan@0"]);
  });

  test("work waits out a touch, then the quiet time after it, while a navigation moves", () => {
    const { work, advance, ran, note } = setup();
    work.touchStarted();
    work.whenFree(note("scan"));
    advance(300);
    assert.deepEqual(ran, []);
    work.touchEnded();
    advance(399);
    assert.deepEqual(ran, []);
    advance(1);
    assert.deepEqual(ran, ["scan@700"]);
  });

  test("a new touch during the quiet time starts it over", () => {
    const { work, advance, ran, note } = setup();
    work.touchStarted();
    work.touchEnded();
    work.whenFree(note("scan"));
    advance(300);
    work.touchStarted();
    work.touchEnded();
    advance(399);
    assert.deepEqual(ran, []);
    advance(1);
    assert.deepEqual(ran, ["scan@700"]);
  });

  test("a long interaction can't starve work: it runs once it waited maxWaitMs", () => {
    const { work, advance, ran, note } = setup();
    work.touchStarted();
    work.whenFree(note("first"));
    advance(1000);
    work.whenFree(note("second"));
    advance(5000);
    // The finger never lifted: each still ran its maxWaitMs after it asked.
    assert.deepEqual(ran, ["first@2000", "second@3000"]);
  });

  test("one piece of work per turn: a touch between two ready pieces holds the second", () => {
    const { work, advance, ran, note } = setup();
    work.whenFree(() => {
      ran.push("first");
      // Lands before the second piece's turn, as a tap queued behind the first slice would.
      work.touchStarted();
    });
    work.whenFree(note("second"));
    advance(0);
    assert.deepEqual(ran, ["first"]);
    work.touchEnded();
    advance(400);
    assert.deepEqual(ran, ["first", "second@400"]);
  });

  test("a touch a scroll or gesture took over still holds work, though its lift goes unheard", () => {
    const { work, advance, ran, note } = setup();
    work.touchStarted();
    advance(100);
    work.touchTakenOver();
    work.whenFree(note("save"));
    advance(1500);
    assert.deepEqual(ran, []);
  });

  test("a taken-over touch counts as lifted takeoverMs after the takeover, so work never waits on it for good", () => {
    const { work, advance, ran, note } = setup({ maxWaitMs: 60_000 });
    work.touchStarted();
    work.touchTakenOver();
    work.whenFree(note("save"));
    advance(3399);
    assert.deepEqual(ran, []);
    advance(1);
    assert.deepEqual(ran, ["save@3400"]);
  });

  test("after a takeover, the next touch's lift ends the wait as usual", () => {
    const { work, advance, ran, note } = setup({ maxWaitMs: 60_000 });
    work.touchStarted();
    work.touchTakenOver();
    work.whenFree(note("save"));
    advance(500);
    work.touchStarted();
    advance(100);
    work.touchEnded();
    advance(399);
    assert.deepEqual(ran, []);
    advance(1);
    assert.deepEqual(ran, ["save@1000"]);
  });

  test("coming back to the foreground holds work like a touch: the owner is about to tap", () => {
    const { work, advance, ran, note } = setup();
    work.resumed();
    work.whenFree(note("rescan"));
    advance(399);
    assert.deepEqual(ran, []);
    advance(1);
    assert.deepEqual(ran, ["rescan@400"]);
  });

  test("a piece of work that throws doesn't stall the work queued after it", () => {
    const { work, advance, ran, note } = setup();
    work.whenFree(() => {
      throw new Error("slice failed");
    });
    work.whenFree(note("next"));
    assert.throws(() => advance(0), /slice failed/);
    advance(0);
    assert.deepEqual(ran, ["next@0"]);
  });

  test("cancelled work never runs, and the next goes in its place", () => {
    const { work, advance, ran, note } = setup();
    const cancel = work.whenFree(note("scan"));
    work.whenFree(note("sync"));
    cancel();
    advance(0);
    assert.deepEqual(ran, ["sync@0"]);
  });
});

describe("what a perf build reports", () => {
  test("when content showed, how startup ended, and how long work waited", () => {
    const { work, advance, note } = setup();
    work.afterContent(note("scan"));
    advance(800);
    work.contentShown();
    work.touchStarted();
    advance(2500);
    work.touchEnded();
    work.whenFree(note("batch"));
    advance(400);
    assert.deepEqual(work.stats(), {
      contentAt: 800,
      contentCapped: false,
      startupStarted: 1,
      slices: 2,
      longestWaitMs: 2000,
      forcedSlices: 1,
    });
  });
});

describe("startup work waits for the first content", () => {
  test("it starts once a screen shows content, in the order asked", () => {
    const { work, advance, ran, note } = setup();
    work.afterContent(note("scan"));
    work.afterContent(note("imports"));
    advance(500);
    assert.deepEqual(ran, []);
    work.contentShown();
    assert.deepEqual(ran, []);
    advance(0);
    assert.deepEqual(ran, ["scan@500", "imports@500"]);
  });

  test("startup work still yields to a touch after the content shows", () => {
    const { work, advance, ran, note } = setup();
    work.afterContent(note("scan"));
    work.contentShown();
    work.touchStarted();
    work.touchEnded();
    advance(399);
    assert.deepEqual(ran, []);
    advance(1);
    assert.deepEqual(ran, ["scan@400"]);
  });

  test("asked once content showed, it only waits for a free turn", () => {
    const { work, advance, ran, note } = setup();
    work.contentShown();
    work.afterContent(note("sync"));
    advance(0);
    assert.deepEqual(ran, ["sync@0"]);
  });

  test("with no screen showing content, it starts contentCapMs after it was first asked", () => {
    const { work, advance, ran, note } = setup();
    advance(100);
    work.afterContent(note("sync"));
    advance(1000);
    work.afterContent(note("scan"));
    advance(1999);
    assert.deepEqual(ran, []);
    advance(1);
    assert.deepEqual(ran, ["sync@3100", "scan@3100"]);
    // Content showing later changes nothing.
    work.contentShown();
    advance(5000);
    assert.equal(ran.length, 2);
  });
});
