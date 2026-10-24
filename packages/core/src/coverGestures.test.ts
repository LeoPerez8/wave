import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { DOUBLE_TAP_MS, coverDoubleTap, createCoverTaps } from "./index.ts";

/** Cover taps on a virtual clock, recording what each gesture turned out to be and when. */
const setup = () => {
  let time = 0;
  const timers: { at: number; run: () => void; cancelled: boolean }[] = [];
  const gestures: { at: number; gesture: "tap" | "doubleTap" }[] = [];
  const taps = createCoverTaps({
    schedule: (ms, run) => {
      const timer = { at: time + ms, run, cancelled: false };
      timers.push(timer);
      return () => {
        timer.cancelled = true;
      };
    },
    onTap: () => gestures.push({ at: time, gesture: "tap" }),
    onDoubleTap: () => gestures.push({ at: time, gesture: "doubleTap" }),
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
      time = due.at;
      due.run();
    }
    time = end;
  };
  return { taps, gestures, advance };
};

describe("tapping the cover in Now Playing", () => {
  test("a single tap plays or pauses once no second tap can follow", () => {
    const { taps, gestures, advance } = setup();
    taps.tap();
    advance(DOUBLE_TAP_MS - 1);
    assert.deepEqual(gestures, []);
    advance(1);
    assert.deepEqual(gestures, [{ at: DOUBLE_TAP_MS, gesture: "tap" }]);
  });

  test("a second tap soon after the first is a double-tap at once, and never a play or pause", () => {
    const { taps, gestures, advance } = setup();
    taps.tap();
    advance(180);
    taps.tap();
    assert.deepEqual(gestures, [{ at: 180, gesture: "doubleTap" }]);
    advance(DOUBLE_TAP_MS * 3);
    assert.deepEqual(gestures, [{ at: 180, gesture: "doubleTap" }]);
  });

  test("taps further apart than a double-tap are two plays or pauses", () => {
    const { taps, gestures, advance } = setup();
    taps.tap();
    advance(DOUBLE_TAP_MS + 50);
    taps.tap();
    advance(DOUBLE_TAP_MS);
    assert.deepEqual(gestures, [
      { at: DOUBLE_TAP_MS, gesture: "tap" },
      { at: DOUBLE_TAP_MS * 2 + 50, gesture: "tap" },
    ]);
  });

  test("taps going on quickly after a double-tap keep showing the star, never pausing", () => {
    const { taps, gestures, advance } = setup();
    taps.tap();
    advance(150);
    taps.tap();
    advance(150);
    taps.tap();
    advance(150);
    taps.tap();
    advance(DOUBLE_TAP_MS * 3);
    assert.deepEqual(gestures, [
      { at: 150, gesture: "doubleTap" },
      { at: 300, gesture: "doubleTap" },
      { at: 450, gesture: "doubleTap" },
    ]);
  });

  test("once the taps stop, the next tap plays or pauses again", () => {
    const { taps, gestures, advance } = setup();
    taps.tap();
    advance(150);
    taps.tap();
    advance(DOUBLE_TAP_MS + 1);
    taps.tap();
    advance(DOUBLE_TAP_MS);
    assert.deepEqual(gestures, [
      { at: 150, gesture: "doubleTap" },
      { at: 150 + DOUBLE_TAP_MS + 1 + DOUBLE_TAP_MS, gesture: "tap" },
    ]);
  });

  test("a tap still waiting when the cover goes away does nothing", () => {
    const { taps, gestures, advance } = setup();
    taps.tap();
    advance(100);
    taps.cancel();
    advance(DOUBLE_TAP_MS * 2);
    assert.deepEqual(gestures, []);
  });
});

describe("double-tapping the cover in Now Playing", () => {
  test("a song not in Favorites is added, with the star", () => {
    assert.equal(coverDoubleTap({ starred: false, canStar: true }), "favorite");
  });

  test("a song already in Favorites only shows the star, and stays in Favorites", () => {
    assert.equal(coverDoubleTap({ starred: true, canStar: true }), "star");
  });

  test("a song that can't be starred yet (a streamed song before the Library is read) does nothing", () => {
    assert.equal(coverDoubleTap({ starred: false, canStar: false }), "none");
  });
});
