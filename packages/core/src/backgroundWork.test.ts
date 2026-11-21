import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { createBackgroundWork, runStepSlice, type BackgroundWorkLimits } from "./index.ts";

const LIMITS: BackgroundWorkLimits = {
  quietMs: 400,
  maxWaitMs: 2000,
  takeoverMs: 3000,
  contentCapMs: 3000,
  transitionCapMs: 5000,
  sliceMs: 8,
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

describe("background work waits out a tap's transition", () => {
  test("nothing runs while a tap's transition is in flight, not even work past maxWaitMs", () => {
    const { work, advance, ran, note } = setup();
    work.whenFree(note("batch"));
    work.transitionStarted();
    advance(4000);
    assert.deepEqual(ran, []);
    work.transitionEnded();
    advance(0);
    assert.deepEqual(ran, ["batch@4000"]);
  });

  test("a transition that never reports its end holds work for transitionCapMs at most", () => {
    const { work, advance, ran, note } = setup();
    work.transitionStarted();
    work.whenFree(note("batch"));
    advance(4999);
    assert.deepEqual(ran, []);
    advance(1);
    assert.deepEqual(ran, ["batch@5000"]);
  });

  test("work that paces itself by frames waits out a transition only, not the quiet after a touch", () => {
    const { work, advance, ran, note } = setup();
    work.touchStarted();
    work.touchEnded();
    assert.equal(work.transitionInFlight(), false);
    work.afterTransition(note("Home mixes"));
    advance(0);
    assert.deepEqual(ran, ["Home mixes@0"]);
    work.transitionStarted();
    assert.equal(work.transitionInFlight(), true);
    const cancel = work.afterTransition(note("dropped"));
    work.afterTransition(note("taste"));
    cancel();
    advance(300);
    assert.deepEqual(ran, ["Home mixes@0"]);
    work.transitionEnded();
    advance(0);
    assert.deepEqual(ran, ["Home mixes@0", "taste@300"]);
  });

  test("a transition past transitionCapMs no longer counts as in flight", () => {
    const { work, advance } = setup();
    work.transitionStarted();
    advance(5000);
    assert.equal(work.transitionInFlight(), false);
  });

  test("a new transition starting as one ends keeps work waiting", () => {
    const { work, advance, ran, note } = setup();
    work.whenFree(note("scan"));
    work.transitionStarted();
    advance(100);
    work.transitionEnded();
    work.transitionStarted();
    advance(0);
    assert.deepEqual(ran, []);
    work.transitionEnded();
    advance(0);
    assert.deepEqual(ran, ["scan@100"]);
  });
});

/** Steps that each take [costs]' ms of the virtual clock, in turn, and count themselves. */
function* costly(advance: (ms: number) => void, costs: readonly number[], done: string[]) {
  for (const [index, cost] of costs.entries()) {
    advance(cost);
    done.push(String(index));
    yield;
  }
  return "finished";
}

describe("stepped work runs in slices of at most sliceMs", () => {
  test("a slice stops before the step that would take it past sliceMs", () => {
    const { work, advance } = setup();
    const done: string[] = [];
    const steps = costly(advance, [3, 3, 3, 3], done);
    assert.deepEqual(work.runSlice("Magic Queue batch", steps), { done: false });
    assert.deepEqual(done, ["0", "1"]);
    assert.deepEqual(work.runSlice("Magic Queue batch", steps), { done: false });
    assert.deepEqual(done, ["0", "1", "2", "3"]);
    assert.deepEqual(work.runSlice("Magic Queue batch", steps), {
      done: true,
      value: "finished",
    });
  });

  test("every slice takes at least one step, so work always moves on", () => {
    const { work, advance } = setup();
    const done: string[] = [];
    const steps = costly(advance, [12, 1], done);
    work.runSlice("scan", steps);
    assert.deepEqual(done, ["0"]);
  });

  test("a slice asked to be shorter than sliceMs, or capped in steps, stops sooner", () => {
    const { work, advance } = setup();
    const done: string[] = [];
    const steps = costly(advance, [1, 1, 1, 1, 1, 1], done);
    work.runSlice("Home mixes", steps, { sliceMs: 2 });
    assert.deepEqual(done, ["0", "1"]);
    work.runSlice("Home mixes", steps, { maxSteps: 1 });
    assert.deepEqual(done, ["0", "1", "2"]);
  });

  test("runStepSlice slices on any clock, with no scheduler", () => {
    let time = 0;
    const done: string[] = [];
    const steps = costly((ms) => (time += ms), [5, 5, 5], done);
    assert.deepEqual(runStepSlice(steps, { now: () => time, sliceMs: 8, maxSteps: 10 }), {
      done: false,
    });
    assert.deepEqual(done, ["0"]);
  });

  test("a perf build hears of the longest slice and those past sliceMs, by name", () => {
    const { work, advance } = setup();
    const steps = costly(advance, [2, 12, 2], []);
    while (!work.runSlice("sync", steps).done);
    // The 12 ms step came second, after a 2 ms one gave no warning of it.
    assert.equal(work.stats().longestSliceMs, 14);
    assert.deepEqual(work.stats().overBudget, { sync: 1 });
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
      longestSliceMs: 0,
      overBudget: {},
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
