import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  TIMING_BUDGETS,
  timingBudgetExceeded,
  slowTapLine,
  slowScreenLine,
  speedSummaryLine,
  type TimingTap,
  TAP_BLOCKS_WAIT_MS,
  createSlowTapLines,
} from "./index.ts";

const tap: TimingTap = {
  kind: "push",
  from: "/library/albums",
  to: "/library/artist/12",
  responseMs: 100,
  firstFrameMs: 50,
  settledMs: 1300,
};

describe("navigation timing budgets", () => {
  test("a push at or under either budget writes nothing; one millisecond over is slow", () => {
    assert.equal(timingBudgetExceeded(tap), false);
    assert.equal(slowTapLine(tap), null);
    assert.equal(slowTapLine({ ...tap, responseMs: 99, firstFrameMs: 49 }), null);
    assert.equal(timingBudgetExceeded({ ...tap, responseMs: 101 }), true);
    assert.equal(timingBudgetExceeded({ ...tap, firstFrameMs: 51 }), true);
    assert.equal(TIMING_BUDGETS.push.responseMs, 100);
    assert.equal(TIMING_BUDGETS.push.firstFrameMs, 50);
    assert.equal(TIMING_BUDGETS.screen.firstFrameMs, 50);
    assert.equal(TIMING_BUDGETS.readMs, 16);
  });
});

describe("all tap kinds", () => {
  const cases = [
    ["tab", "tab", "responseMs", 100],
    ["tab", "tab", "firstFrameMs", 50],
    ["push", "push", "responseMs", 100],
    ["push", "push", "firstFrameMs", 50],
    ["pop", "pop", "responseMs", 100],
    ["pop", "pop", "firstFrameMs", 50],
    ["nowPlayingOpen", "Now Playing open", "responseMs", 50],
    ["nowPlayingOpen", "Now Playing open", "firstFrameMs", 50],
    ["nowPlayingClose", "Now Playing close", "responseMs", 50],
    ["nowPlayingClose", "Now Playing close", "firstFrameMs", 50],
    ["queue", "Queue", "responseMs", 100],
    ["queue", "Queue", "firstFrameMs", 50],
    ["relatedOpen", "Related open", "firstFrameMs", 50],
    ["relatedClose", "Related close", "firstFrameMs", 50],
    ["choiceCard", "choice card", "responseMs", 100],
    ["artistLink", "artist link", "firstFrameMs", 200],
    ["albumLink", "album link", "firstFrameMs", 200],
    ["goToArtist", "Go to Artist", "firstFrameMs", 200],
  ] as const;
  for (const [kind, name, measure, budget] of cases) {
    test(`${name} ${measure}: under, at, over the budget`, () => {
      const fast = { ...tap, kind, responseMs: 0, firstFrameMs: 0 };
      assert.equal(slowTapLine({ ...fast, [measure]: budget - 1 }), null);
      assert.equal(slowTapLine({ ...fast, [measure]: budget }), null);
      const slow = { ...fast, [measure]: budget + 1 };
      assert.equal(timingBudgetExceeded(slow), true);
      const line = slowTapLine(slow)!;
      assert.ok(line.startsWith(`Slow ${name} to /library/artist/12 from /library/albums:`));
      assert.ok(line.includes("settled 1.3 s"));
      assert.ok(line.endsWith("meanwhile: none; longest JS block 0 ms"));
    });
  }
  test("slow taps name overlapping background work, offline and the longest JS block", () => {
    assert.equal(
      slowTapLine({
        ...tap,
        responseMs: 412,
        firstFrameMs: 655,
        background: ["scan", "import", "3 downloads", "Magic Queue batch"],
        offline: true,
        longestJsBlockMs: 380,
      }),
      "Slow push to /library/artist/12 from /library/albums: response 412 ms, first frame 655 ms, settled 1.3 s (budget 100 ms response / 50 ms first frame); meanwhile: scan, import, 3 downloads, Magic Queue batch; offline; longest JS block 380 ms",
    );
  });
});

describe("screen content", () => {
  test("both screen budgets are strict and reads are optional", () => {
    const screen = { route: "/library/artist/12", firstFrameMs: 50, contentMs: 400 };
    assert.equal(slowScreenLine(screen), null);
    assert.equal(slowScreenLine({ ...screen, firstFrameMs: 49, contentMs: 399 }), null);
    assert.equal(
      slowScreenLine({ ...screen, firstFrameMs: 51 }),
      "Slow screen /library/artist/12: first frame 51 ms, content 400 ms (budget 50 ms / 400 ms); reads: none",
    );
    assert.equal(
      slowScreenLine({ ...screen, contentMs: 401 }),
      "Slow screen /library/artist/12: first frame 50 ms, content 401 ms (budget 50 ms / 400 ms); reads: none",
    );
    assert.equal(
      slowScreenLine({
        ...screen,
        contentMs: 1400,
        reads: [
          { operation: "artist", durationMs: 12 },
          { operation: "whole-Library songs", durationMs: 960 },
        ],
      }),
      "Slow screen /library/artist/12: first frame 50 ms, content 1.4 s (budget 50 ms / 400 ms); reads: artist 12 ms, whole-Library songs 960 ms",
    );
  });
});

describe("speed summaries", () => {
  const window = {
    since: new Date(2026, 9, 22, 14, 2).getTime(),
    version: "0.19.0-ti",
    commit: "460e39f",
    taps: [] as TimingTap[],
    screens: [],
  };
  test("no taps means no line", () => assert.equal(speedSummaryLine(window), null));
  test("one tap includes its kind and build", () =>
    assert.equal(
      speedSummaryLine({ ...window, taps: [tap] }),
      "Speed since 14:02 (Wave 0.19.0-ti @ 460e39f): 1 taps; push 1 first frame median 50 ms p90 50 ms, response median 100 ms p90 100 ms; slow 0, lost 0, hitches 0 (longest 0 ms)",
    ));
  test("odd and even medians and nearest rank p90 use the complete window", () => {
    const response = [10, 200, 30, 40, 50, 60, 70, 80, 90, 100];
    const taps = response.map((responseMs) => ({ ...tap, responseMs, firstFrameMs: responseMs }));
    const even = speedSummaryLine({ ...window, taps })!;
    assert.ok(even.includes("push 10 first frame median 65 ms p90 100 ms"));
    assert.ok(even.includes("slow 6"));
    assert.ok(
      speedSummaryLine({ ...window, taps: taps.slice(0, 3) })!.includes(
        "push 3 first frame median 30 ms p90 200 ms",
      ),
    );
  });
  test("screens and other timing tickets contribute without mixing tap kinds", () => {
    const line = speedSummaryLine({
      ...window,
      taps: [tap, { ...tap, kind: "tab", responseMs: 20 }],
      screens: [
        { route: "/a", firstFrameMs: 100, contentMs: 100, missedFrames: 2 },
        { route: "/a", firstFrameMs: 100, contentMs: 300, missedFrames: 5 },
      ],
      lostTaps: 1,
      hitches: [500, 1100],
    })!;
    assert.ok(
      line.includes(
        "tab 1 first frame median 50 ms p90 50 ms, response median 20 ms p90 20 ms; push 1 first frame median 50 ms p90 50 ms, response median 100 ms p90 100 ms",
      ),
    );
    assert.ok(line.includes("screen /a content median 200 ms p90 300 ms, missed frames 7"));
    assert.ok(line.endsWith("slow 0, lost 1, hitches 2 (longest 1.1 s)"));
  });
  test("Related open and close each report median and p90", () => {
    const line = speedSummaryLine({
      ...window,
      taps: [
        { ...tap, kind: "relatedOpen", responseMs: 25, firstFrameMs: 25 },
        { ...tap, kind: "relatedOpen", responseMs: 80, firstFrameMs: 80 },
        { ...tap, kind: "relatedClose", responseMs: 20, firstFrameMs: 20 },
      ],
    })!;
    assert.ok(line.includes("Related open 2 first frame median 53 ms p90 80 ms"));
    assert.ok(line.includes("Related close 1 first frame median 20 ms p90 20 ms"));
  });
  test("a milestone seen on only some taps says how many it measured", () => {
    const line = speedSummaryLine({
      ...window,
      measurements: [
        { kind: "push", responseMs: 30, firstFrameMs: 40 },
        { kind: "push", firstFrameMs: 60 },
        { kind: "choiceCard", responseMs: 30 },
        { kind: "goToArtist" },
      ],
    })!;
    assert.ok(
      line.includes(
        "push 2 first frame median 50 ms p90 60 ms, response (1 measured) median 30 ms p90 30 ms; ",
      ),
    );
    assert.ok(line.includes("; choice card 1 response median 30 ms p90 30 ms; "));
    assert.ok(line.includes("; Go to Artist 1 response not observed; "));
  });
});

test("timing durations use the log's rounding and switch units at one second", async () => {
  const { timingDuration } = await import("./index.ts");
  assert.equal(timingDuration(0), "0 ms");
  assert.equal(timingDuration(999), "999 ms");
  assert.equal(timingDuration(1000), "1.0 s");
  assert.equal(timingDuration(1450), "1.5 s");
});

describe("a slow tap's line waits for the JS blocks of its window (#1446)", () => {
  const slow: TimingTap = { ...tap, responseMs: 363, firstFrameMs: 400, settledMs: 500 };
  const setup = () => {
    const lines: string[] = [];
    const timers: (() => void)[] = [];
    const taps = createSlowTapLines({
      write: (line) => lines.push(line),
      later: (ms, run) => {
        assert.equal(ms, TAP_BLOCKS_WAIT_MS);
        timers.push(run);
      },
    });
    const run = () => {
      for (const timer of timers.splice(0)) timer();
    };
    return { taps, lines, run };
  };

  test("a block reported just after the tap settled is its longest", () => {
    const { taps, lines, run } = setup();
    // The tap began at 1000 and settled at 1500; the block it settled in is reported late.
    taps.settled(slow, 1000, 1500);
    assert.deepEqual(lines, []);
    taps.block(1290, 237);
    run();
    assert.equal(lines.length, 1);
    assert.match(lines[0]!, /longest JS block 237 ms$/);
  });

  test("blocks outside the window don't count, and the longest seen before settling stays", () => {
    const { taps, lines, run } = setup();
    taps.settled({ ...slow, longestJsBlockMs: 120 }, 1000, 1500);
    taps.block(800, 150); // Ended before the tap began.
    taps.block(1600, 400); // Began after it settled.
    taps.block(1100, 90);
    run();
    assert.match(lines[0]!, /longest JS block 120 ms$/);
  });

  test("a tap within budget writes nothing", () => {
    const { taps, lines, run } = setup();
    taps.settled(tap, 1000, 1300);
    taps.block(1100, 200);
    run();
    assert.deepEqual(lines, []);
  });

  test("leaving the screen writes the waiting lines at once, each once", () => {
    const { taps, lines, run } = setup();
    taps.settled(slow, 1000, 1500);
    taps.settled({ ...slow, to: "/" }, 2000, 2500);
    taps.block(2100, 300);
    taps.flush();
    assert.equal(lines.length, 2);
    assert.match(lines[0]!, /longest JS block 0 ms$/);
    assert.match(lines[1]!, /to \/ from .*longest JS block 300 ms$/);
    run();
    assert.equal(lines.length, 2);
  });
});
