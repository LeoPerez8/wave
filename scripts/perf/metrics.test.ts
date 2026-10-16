import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { PerfEntry, PerfFlush } from "../../packages/core/src/index.ts";
import type { GfxFrame, GfxSummary } from "./device.ts";
import {
  compareSummaries,
  formatComparison,
  formatSummary,
  stepMetrics,
  summarize,
  type StepRecord,
} from "./metrics.ts";

const INTERVAL = 8.33;

/** A frame that started at [start] ms and took [ms]. */
const frame = (
  start: number,
  ms: number,
  deadlineMs: number | null = start + 2 * INTERVAL,
): GfxFrame => ({
  window: "main",
  flags: 0,
  inputEventId: 0,
  intendedVsyncMs: start,
  completedMs: start + ms,
  deadlineMs,
  intervalMs: INTERVAL,
});

const SUMMARY: GfxSummary = {
  totalFrames: 4,
  jankyFrames: 1,
  p50Ms: 6,
  p90Ms: 30,
  p95Ms: 30,
  p99Ms: 30,
  missedVsync: 0,
  highInputLatency: 0,
  slowUiThread: 1,
  slowBitmapUploads: 0,
  slowIssueDrawCommands: 0,
  frameDeadlineMissed: 1,
  histogram: [
    [6, 3],
    [30, 1],
  ],
};

const flush = (entries: PerfEntry[], renders: Record<string, number> = {}): PerfFlush => ({
  tag: "t",
  meta: {},
  entries,
  renders,
  dropped: 0,
  complete: true,
});

describe("stepMetrics", () => {
  // A touch at 1000 ms that JavaScript saw at 1012; the route showed at 1150.
  const entries: PerfEntry[] = [
    { kind: "touch", eventAt: 1_000, at: 1_012 },
    { kind: "mark", name: "route", detail: "/settings", at: 1_150 },
    { kind: "longtask", at: 1_020, duration: 90 },
    { kind: "longtask", at: 1_200, duration: 60 },
  ];
  const frames = [
    // Before the touch: the previous step's tail, not this one's.
    frame(900, 6),
    frame(1_004, 6),
    frame(1_012.3, 30),
    frame(1_050, 6),
    // After a quiet spell longer than the settle gap: not part of the response.
    frame(1_600, 6),
  ];

  it("measures from the touch's native timestamp", () => {
    const metrics = stepMetrics({
      frames,
      summary: SUMMARY,
      flush: flush(entries, { TabBar: 2 }),
      expect: { mark: "route" },
    });
    assert.equal(metrics.touchAt, 1_000);
    assert.equal(metrics.inputToJsMs, 12);
    assert.equal(metrics.firstFrameMs, 10);
    assert.equal(metrics.responseMs, 150);
    assert.equal(metrics.settleMs, 56);
    assert.equal(metrics.burstMs, 52);
    assert.equal(metrics.expectMissing, false);
    assert.deepEqual(metrics.renders, { TabBar: 2 });
    assert.deepEqual(metrics.longTasks, { count: 2, totalMs: 150, maxMs: 90 });
  });

  it("counts frames that missed their deadline from gfxinfo's totals", () => {
    const metrics = stepMetrics({
      frames,
      summary: SUMMARY,
      flush: flush(entries),
      expect: undefined,
    });
    assert.equal(metrics.frames.total, 4);
    assert.equal(metrics.frames.deadlineMissed, 1);
    assert.equal(metrics.frames.p90Ms, 30);
  });

  it("matches an expected mark's detail, when it names one", () => {
    const metrics = stepMetrics({
      frames,
      summary: SUMMARY,
      flush: flush([
        { kind: "touch", eventAt: 1_000, at: 1_010 },
        { kind: "mark", name: "visible", detail: "lyrics", at: 1_100 },
        { kind: "mark", name: "visible", detail: "queue", at: 1_180 },
      ]),
      expect: { mark: "visible", detail: "queue" },
    });
    assert.equal(metrics.responseMs, 180);
  });

  it("times each traced mark's first occurrence after the touch", () => {
    const metrics = stepMetrics({
      frames,
      summary: SUMMARY,
      flush: flush([
        { kind: "mark", name: "nowPlaying.spring", detail: "closed", at: 900 },
        { kind: "touch", eventAt: 1_000, at: 1_030 },
        { kind: "mark", name: "nowPlaying.step", detail: "tap", at: 1_032 },
        { kind: "mark", name: "nowPlaying.notified", at: 1_040 },
        { kind: "mark", name: "nowPlaying.spring", detail: "rise", at: 1_041 },
        { kind: "mark", name: "nowPlaying.spring", detail: "open", at: 1_400 },
      ]),
      expect: undefined,
      trace: ["nowPlaying.step", "nowPlaying.spring", "nowPlaying.motion"],
    });
    assert.deepEqual(metrics.traceMs, {
      "nowPlaying.step": 32,
      "nowPlaying.spring": 41,
      "nowPlaying.motion": null,
    });
  });

  it("says when the expected mark never came", () => {
    const metrics = stepMetrics({
      frames,
      summary: SUMMARY,
      flush: flush([{ kind: "touch", eventAt: 1_000, at: 1_010 }]),
      expect: { mark: "keyboard.show" },
    });
    assert.equal(metrics.responseMs, null);
    assert.equal(metrics.expectMissing, true);
  });

  it("anchors to the last touch when the step asks (rapid taps)", () => {
    const metrics = stepMetrics({
      frames,
      summary: SUMMARY,
      flush: flush([
        { kind: "touch", eventAt: 900, at: 905 },
        { kind: "touch", eventAt: 1_000, at: 1_004 },
        { kind: "mark", name: "route", detail: "/", at: 950 },
        { kind: "mark", name: "route", detail: "/library", at: 1_100 },
      ]),
      expect: { mark: "route" },
      anchor: "last",
    });
    assert.equal(metrics.touchAt, 1_000);
    assert.equal(metrics.responseMs, 100);
    assert.equal(metrics.finalRoute, "/library");
  });

  it("without a perf build, keeps the frame burst and leaves the latencies out", () => {
    const metrics = stepMetrics({
      frames: frames.slice(1),
      summary: SUMMARY,
      flush: null,
      expect: { mark: "route" },
    });
    assert.equal(metrics.touchAt, null);
    assert.equal(metrics.firstFrameMs, null);
    assert.equal(metrics.responseMs, null);
    assert.equal(metrics.expectMissing, null);
    assert.equal(metrics.burstMs, 52);
  });

  it("doesn't claim a first frame when gfxinfo let the early frames go", () => {
    const late = [frame(1_400, 6), frame(1_408, 6)];
    const metrics = stepMetrics({
      frames: late,
      summary: { ...SUMMARY, totalFrames: 300 },
      flush: flush([{ kind: "touch", eventAt: 1_000, at: 1_010 }]),
      expect: undefined,
    });
    assert.equal(metrics.firstFrameMs, null);
    assert.equal(metrics.framesCovered, false);
  });
});

const record = (
  scenario: string,
  measure: string,
  responseMs: number | null,
  extra: Partial<StepRecord> = {},
): StepRecord => {
  const base = stepMetrics({ frames: [], summary: SUMMARY, flush: null, expect: undefined });
  return {
    type: "step",
    run: "r",
    scenario,
    variant: "idle",
    measure,
    iteration: 1,
    index: 0,
    ...base,
    responseMs,
    ...extra,
  };
};

describe("summarize", () => {
  it("takes the median, 90th percentile and max per scenario, variant and measure", () => {
    const records = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100].map((ms) =>
      record("tab-switch", "tab", ms),
    );
    const [row] = summarize(records);
    assert.equal(row?.key, "tab-switch/idle/tab");
    assert.deepEqual(row?.metrics.responseMs, { n: 10, median: 55, p90: 90, max: 100 });
  });

  it("pools the frame histograms and counts deadline misses across steps", () => {
    const [row] = summarize([record("queue", "open", 1), record("queue", "open", 2)]);
    assert.equal(row?.frames.total, 8);
    assert.equal(row?.frames.deadlineMissed, 2);
    assert.equal(row?.frames.missRate, 0.25);
    assert.equal(row?.frames.p50Ms, 6);
    assert.equal(row?.frames.p90Ms, 30);
  });

  it("averages render counts per step and counts steps whose mark never came", () => {
    const rows = summarize([
      record("push-settings", "push", 100, {
        renders: { TabBar: 2, MiniPlayer: 1 },
        expectMissing: false,
      }),
      record("push-settings", "push", null, { renders: { TabBar: 4 }, expectMissing: true }),
    ]);
    assert.deepEqual(rows[0]?.rendersPerStep, { MiniPlayer: 0.5, TabBar: 3 });
    assert.equal(rows[0]?.missing, 1);
  });

  it("sums up each traced mark, and compares it", () => {
    const traced = (ms: number | null) =>
      record("now-playing", "open", 100, { traceMs: { "nowPlaying.spring": ms } });
    const before = summarize([traced(30), traced(50), traced(null)]);
    assert.deepEqual(before[0]?.trace["nowPlaying.spring"], {
      n: 2,
      median: 40,
      p90: 50,
      max: 50,
    });
    const after = summarize([traced(4), traced(6)]);
    const row = compareSummaries(before, after).find(
      (r) => r.metric === "nowPlaying.spring median",
    );
    assert.equal(row?.change, -35);
  });
});

describe("formatSummary", () => {
  it("prints one Markdown row per scenario step, with - for what wasn't measured", () => {
    const table = formatSummary(
      summarize([record("push-settings", "push", 120), record("push-settings", "push", 80)]),
    );
    assert.match(table, /^\| Scenario step \| Steps \| Response ms/m);
    assert.match(
      table,
      /^\| push-settings\/idle\/push \| 2 \| 100 \/ 120 \| - \| - \| - \| 8 \| 25% \| 30 \| 0 \| 0 \|$/m,
    );
  });
});

describe("compareSummaries", () => {
  it("pairs the same scenario step before and after, with the change", () => {
    const before = summarize([
      record("now-playing", "open", 200),
      record("now-playing", "open", 220),
    ]);
    const after = summarize([
      record("now-playing", "open", 100),
      record("now-playing", "open", 110),
    ]);
    const rows = compareSummaries(before, after);
    const response = rows.find((row) => row.metric === "responseMs median");
    assert.deepEqual(response, {
      key: "now-playing/idle/open",
      metric: "responseMs median",
      before: 210,
      after: 105,
      change: -105,
      changePercent: -50,
    });
  });

  it("leaves out scenarios only one side ran", () => {
    const rows = compareSummaries(
      summarize([record("a", "x", 1)]),
      summarize([record("b", "x", 1)]),
    );
    assert.deepEqual(rows, []);
  });

  it("prints a Markdown table", () => {
    const table = formatComparison(
      compareSummaries(summarize([record("a", "x", 200)]), summarize([record("a", "x", 150)])),
    );
    assert.match(table, /^\| Scenario step \| Metric \| Before \| After \| Change \|$/m);
    assert.match(table, /^\| a\/idle\/x \| responseMs median \| 200 \| 150 \| -50 \(-25%\) \|$/m);
  });
});
