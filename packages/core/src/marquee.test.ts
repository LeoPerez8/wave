import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  MARQUEE,
  marqueeOffset,
  marqueePlan,
  marqueeStill,
  readsRightToLeft,
  type MarqueeLineSize,
  type MarqueePlan,
} from "./index.ts";

/** The plan for [sizes], which must move. */
const moving = (sizes: readonly (MarqueeLineSize | null)[], scale = 1): MarqueePlan => {
  const plan = marqueePlan(sizes, scale);
  assert.ok(plan);
  return plan;
};

/** [actual] is [expected] but for floating-point rounding. */
const near = (actual: number, expected: number): void =>
  assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} is not ${expected}`);

/** How long a line [text] dp wide takes to scroll one loop at scale 1. */
const scrollMs = (text: number): number => ((text + MARQUEE.gap) / MARQUEE.dpPerSecond) * 1000;

describe("marqueeStill", () => {
  test("moves at any positive animator scale", () => {
    assert.equal(marqueeStill({ reduceMotion: false, animatorScale: 1 }), false);
    assert.equal(marqueeStill({ reduceMotion: false, animatorScale: 0.5 }), false);
    assert.equal(marqueeStill({ reduceMotion: false, animatorScale: 10 }), false);
  });

  test("holds still with animations removed or reduce motion on", () => {
    assert.equal(marqueeStill({ reduceMotion: false, animatorScale: 0 }), true);
    assert.equal(marqueeStill({ reduceMotion: true, animatorScale: 1 }), true);
  });

  test("an unreadable scale moves as at 1x", () => {
    assert.equal(marqueeStill({ reduceMotion: false, animatorScale: Number.NaN }), false);
    assert.equal(marqueeStill({ reduceMotion: false, animatorScale: -1 }), false);
  });
});

describe("marqueePlan", () => {
  test("nothing moves when every line fits", () => {
    assert.equal(
      marqueePlan(
        [
          { text: 120, box: 300 },
          { text: 300, box: 300 },
        ],
        1,
      ),
      null,
    );
  });

  test("a line a hair over its box (sub-pixel rounding) still fits", () => {
    assert.equal(marqueePlan([{ text: 300.6, box: 300 }], 1), null);
  });

  test("unmeasured lines don't move", () => {
    assert.equal(marqueePlan([null, null], 1), null);
  });

  test("a line too long rests, then loops its width plus the gap at the set pace", () => {
    const plan = marqueePlan([{ text: 500, box: 300 }], 1);
    assert.deepEqual(plan, {
      restMs: MARQUEE.restMs,
      cycleMs: MARQUEE.restMs + scrollMs(500),
      lines: [{ travel: 500 + MARQUEE.gap, scrollMs: scrollMs(500), idleMs: 0 }],
    });
  });

  test("the pace is 30 dp a second after a 3 s rest, the loop's gap 32 dp", () => {
    assert.equal(MARQUEE.restMs, 3000);
    assert.equal(MARQUEE.dpPerSecond, 30);
    assert.equal(MARQUEE.gap, 32);
  });

  test("lines that fit stay put while the others move", () => {
    const plan = moving([{ text: 200, box: 300 }, null, { text: 400, box: 300 }]);
    assert.equal(plan.lines[0], null);
    assert.equal(plan.lines[1], null);
    assert.equal(plan.lines[2]?.travel, 400 + MARQUEE.gap);
  });

  test("lines start together and the rest waits for the longest", () => {
    const plan = moving([
      { text: 600, box: 300 },
      { text: 400, box: 300 },
    ]);
    assert.equal(plan.cycleMs, MARQUEE.restMs + scrollMs(600));
    assert.equal(plan.lines[0]?.idleMs, 0);
    // The shorter waits at its start until the longest has finished.
    assert.equal(plan.lines[1]?.scrollMs, scrollMs(400));
    assert.equal(plan.lines[1]?.idleMs, scrollMs(600) - scrollMs(400));
    for (const line of plan.lines) {
      if (line === null) continue;
      assert.equal(plan.restMs + line.scrollMs + line.idleMs, plan.cycleMs);
    }
  });

  test("the animator scale stretches every time, so 0.5x runs twice as fast", () => {
    const full = moving([{ text: 500, box: 300 }]);
    const half = moving([{ text: 500, box: 300 }], 0.5);
    assert.equal(half.restMs, full.restMs / 2);
    assert.equal(half.cycleMs, full.cycleMs / 2);
    assert.equal(half.lines[0]?.scrollMs, (full.lines[0]?.scrollMs ?? 0) / 2);
    // The distance doesn't change, only the time.
    assert.equal(half.lines[0]?.travel, full.lines[0]?.travel);
  });

  test("no plan with animations removed: the lines hold still", () => {
    assert.equal(marqueePlan([{ text: 500, box: 300 }], 0), null);
  });

  test("an unreadable scale times as at 1x", () => {
    assert.deepEqual(
      marqueePlan([{ text: 500, box: 300 }], Number.NaN),
      marqueePlan([{ text: 500, box: 300 }], 1),
    );
  });
});

describe("marqueeOffset", () => {
  const plan = moving([
    { text: 600, box: 300 },
    { text: 400, box: 300 },
  ]);
  const [long, short] = plan.lines;

  test("every line rests at its start for the rest", () => {
    assert.equal(marqueeOffset(plan, long ?? null, 0), 0);
    assert.equal(marqueeOffset(plan, short ?? null, plan.restMs), 0);
  });

  test("then moves at a steady pace, a whole loop over its scroll", () => {
    const line = long ?? null;
    near(marqueeOffset(plan, line, plan.restMs + (line?.scrollMs ?? 0) / 2), 316);
    near(marqueeOffset(plan, line, plan.restMs + 1000), MARQUEE.dpPerSecond);
  });

  test("a shorter line, back at its start, waits there for the longest", () => {
    const end = plan.restMs + (short?.scrollMs ?? 0);
    assert.equal(marqueeOffset(plan, short ?? null, end), 0);
    assert.equal(marqueeOffset(plan, short ?? null, end + 1), 0);
    assert.equal(marqueeOffset(plan, short ?? null, plan.cycleMs - 1), 0);
  });

  test("lines that don't move, or no plan, stay at their start", () => {
    assert.equal(marqueeOffset(plan, null, plan.restMs + 500), 0);
    assert.equal(marqueeOffset(null, long ?? null, plan.restMs + 500), 0);
  });

  test("a clock past the cycle wraps to its start", () => {
    assert.equal(marqueeOffset(plan, long ?? null, plan.cycleMs), 0);
    near(marqueeOffset(plan, long ?? null, plan.cycleMs + plan.restMs + 1000), MARQUEE.dpPerSecond);
  });
});

describe("readsRightToLeft", () => {
  test("Latin, digits and symbols read left to right", () => {
    assert.equal(readsRightToLeft("Bohemian Rhapsody"), false);
    assert.equal(readsRightToLeft("1999 (Remastered)"), false);
    assert.equal(readsRightToLeft(""), false);
  });

  test("Hebrew and Arabic read right to left", () => {
    assert.equal(readsRightToLeft("שיר לשלום"), true);
    assert.equal(readsRightToLeft("أغنية"), true);
    // Adlam, beyond the Basic Multilingual Plane.
    assert.equal(readsRightToLeft(String.fromCodePoint(0x1e900, 0x1e901)), true);
  });

  test("the first letter with a direction decides", () => {
    assert.equal(readsRightToLeft("2020 - أغنية feat. Someone"), true);
    assert.equal(readsRightToLeft("Song (أغنية)"), false);
  });
});
