import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { createLandings, type LibraryChange } from "./index.ts";

/** Landings on a virtual clock, recording what they announce and when. */
const setup = () => {
  let time = 0;
  const timers: { at: number; run: () => void; cancelled: boolean }[] = [];
  const announced: { at: number; change: LibraryChange }[] = [];
  const landings = createLandings({
    schedule: (ms, run) => {
      const timer = { at: time + ms, run, cancelled: false };
      timers.push(timer);
      return () => {
        timer.cancelled = true;
      };
    },
    announce: (change) => announced.push({ at: time, change }),
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
  return { landings, announced, advance };
};

describe("songs landing during a download run", () => {
  test("five songs landing every few seconds reach the lists at most every two seconds", () => {
    const { landings, announced, advance } = setup();
    // Five downloads at once finish close together, then the next five.
    for (const [trackId, gap] of [
      [1, 0],
      [2, 300],
      [3, 900],
      [4, 400],
      [5, 1200],
      [6, 500],
      [7, 700],
      [8, 300],
    ] as const) {
      advance(gap);
      landings.land([trackId]);
    }
    advance(10_000);

    const times = announced.map(({ at }) => at);
    for (let i = 1; i < times.length; i++)
      assert.ok(times[i]! - times[i - 1]! >= 2000, `announced at ${times.join(", ")}`);
    assert.deepEqual(
      announced.flatMap(({ change }) => change.ids ?? []),
      [1, 2, 3, 4, 5, 6, 7, 8],
    );
    assert.ok(announced.length < 8);
  });

  test("the run's last song reaches the lists at once, with what landed before it", () => {
    const { landings, announced, advance } = setup();
    landings.land([1]);
    advance(500);
    landings.land([2], { last: true });

    assert.deepEqual(announced, [
      { at: 500, change: { kind: "tracks", ids: [1, 2], burst: true } },
    ]);
    advance(10_000);
    assert.equal(announced.length, 1);
  });

  test("a song's fill-in landing while its import waits makes one change", () => {
    const { landings, announced, advance } = setup();
    landings.land([7]);
    advance(1500);
    landings.land([7]);
    advance(10_000);

    assert.deepEqual(announced, [{ at: 2000, change: { kind: "tracks", ids: [7], burst: true } }]);
  });

  test("nothing landed, nothing announced", () => {
    const { landings, announced, advance } = setup();
    landings.land([], { last: true });
    advance(10_000);

    assert.deepEqual(announced, []);
  });
});
