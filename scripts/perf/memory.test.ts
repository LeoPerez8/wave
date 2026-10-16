import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { compareMemory, formatGrowth, memoryGrowth } from "./memory.ts";
import type { MemoryRecord } from "./results.ts";

const sample = (iteration: number, fields: Partial<MemoryRecord>): MemoryRecord => ({
  type: "memory",
  run: "soak",
  scenario: "soak-player",
  variant: "idle",
  iteration,
  ...fields,
});

/** The last step of each cycle, as the runner records it: counters at the step's flush. */
const cycleEnd = (
  iteration: number,
  listeners: Record<string, number>,
  extra: { jsHeapUsed?: number; libraryQueries?: Record<string, number> } = {},
) => ({
  scenario: "soak-player",
  variant: "idle",
  iteration,
  index: 3,
  listeners,
  ...extra,
});

describe("memoryGrowth", () => {
  it("tells memory still growing late in the cycling from memory that levelled off", () => {
    const rows = memoryGrowth({
      memory: [
        sample(0, { totalPssKb: 200_000, javaHeapKb: 20_000, nativeHeapKb: 60_000, views: 540 }),
        sample(2, { totalPssKb: 210_000, javaHeapKb: 26_000, nativeHeapKb: 60_000, views: 541 }),
        sample(4, { totalPssKb: 220_000, javaHeapKb: 26_100, nativeHeapKb: 60_000, views: 540 }),
        sample(6, { totalPssKb: 230_000, javaHeapKb: 26_050, nativeHeapKb: 60_000, views: 542 }),
        sample(8, { totalPssKb: 240_000, javaHeapKb: 26_200, nativeHeapKb: 60_000, views: 541 }),
      ],
      steps: [],
    });
    const byMeasure = Object.fromEntries(rows.map((row) => [row.measure, row]));
    assert.deepEqual(byMeasure["totalPssKb"], {
      key: "soak-player/idle",
      measure: "totalPssKb",
      unit: "KB",
      samples: 5,
      first: 200_000,
      last: 240_000,
      change: 40_000,
      lateChange: 20_000,
      verdict: "still growing",
    });
    assert.equal(byMeasure["javaHeapKb"]?.verdict, "levelled");
    assert.equal(byMeasure["nativeHeapKb"]?.verdict, "flat");
    // A view or two either way is the garbage collector's timing, not a leak.
    assert.equal(byMeasure["views"]?.verdict, "flat");
  });

  it("counts any listener or cached query added late in the cycling as growth", () => {
    const rows = memoryGrowth({
      memory: [sample(0, {}), sample(5, {})],
      steps: [
        cycleEnd(1, { playback: 6, queue: 3 }, { libraryQueries: { entries: 9, consumers: 14 } }),
        cycleEnd(2, { playback: 7, queue: 3 }, { libraryQueries: { entries: 9, consumers: 14 } }),
        cycleEnd(3, { playback: 8, queue: 3 }, { libraryQueries: { entries: 9, consumers: 15 } }),
        cycleEnd(4, { playback: 9, queue: 3 }, { libraryQueries: { entries: 9, consumers: 15 } }),
        cycleEnd(5, { playback: 10, queue: 3 }, { libraryQueries: { entries: 9, consumers: 16 } }),
      ],
    });
    const byMeasure = Object.fromEntries(rows.map((row) => [row.measure, row]));
    assert.equal(byMeasure["listeners.playback"]?.verdict, "still growing");
    assert.equal(byMeasure["listeners.playback"]?.change, 4);
    assert.equal(byMeasure["listeners.queue"]?.verdict, "flat");
    assert.equal(byMeasure["libraryQueries.entries"]?.verdict, "flat");
    assert.equal(byMeasure["libraryQueries.consumers"]?.verdict, "still growing");
  });

  it("reads each cycle's counters from its last step only", () => {
    const rows = memoryGrowth({
      memory: [sample(0, {}), sample(3, {})],
      steps: [
        { ...cycleEnd(1, { playback: 6 }), index: 0, jsHeapUsed: 90_000_000 },
        cycleEnd(1, { playback: 6 }, { jsHeapUsed: 40_000_000 }),
        { ...cycleEnd(2, { playback: 6 }), index: 0, jsHeapUsed: 95_000_000 },
        cycleEnd(2, { playback: 6 }, { jsHeapUsed: 40_100_000 }),
        cycleEnd(3, { playback: 6 }, { jsHeapUsed: 40_200_000 }),
      ],
    });
    const heap = rows.find((row) => row.measure === "jsHeapUsed");
    assert.equal(heap?.first, 40_000_000);
    assert.equal(heap?.last, 40_200_000);
    assert.equal(heap?.unit, "bytes");
    assert.equal(heap?.verdict, "flat");
  });

  it("leaves scenarios that read memory once out", () => {
    const once: MemoryRecord = {
      type: "memory",
      run: "baseline",
      scenario: "push-settings",
      variant: "idle",
      totalPssKb: 250_000,
    };
    const steps = [1, 2, 3].map((iteration) => ({
      ...cycleEnd(iteration, { playback: 5 + iteration }),
      scenario: "push-settings",
    }));
    assert.deepEqual(memoryGrowth({ memory: [once], steps }), []);
  });

  it("gives no verdict on two samples", () => {
    const [row] = memoryGrowth({
      memory: [sample(0, { totalPssKb: 200_000 }), sample(4, { totalPssKb: 260_000 })],
      steps: [],
    });
    assert.equal(row?.verdict, "too few samples");
  });
});

describe("compareMemory", () => {
  const retained = (scenario: string, fields: Partial<MemoryRecord>): MemoryRecord => ({
    type: "memory",
    run: "r",
    scenario,
    variant: "idle",
    ...fields,
  });

  it("lines up each scenario's retained memory at its end, before and after", () => {
    const rows = compareMemory(
      [
        retained("push-settings", { totalPssKb: 250_000, javaHeapKb: 30_000, views: 600 }),
        retained("only-before", { totalPssKb: 1 }),
      ],
      [
        retained("push-settings", { totalPssKb: 230_000, javaHeapKb: 31_000, views: 450 }),
        retained("only-after", { totalPssKb: 1 }),
      ],
    );
    assert.deepEqual(
      rows.filter((one) => one.key === "push-settings/idle"),
      [
        {
          key: "push-settings/idle",
          measure: "totalPssKb",
          unit: "KB",
          before: 250_000,
          after: 230_000,
        },
        {
          key: "push-settings/idle",
          measure: "javaHeapKb",
          unit: "KB",
          before: 30_000,
          after: 31_000,
        },
        { key: "push-settings/idle", measure: "views", unit: "objects", before: 600, after: 450 },
      ],
    );
    // A scenario run on one side only shows with the other side empty.
    assert.deepEqual(
      rows.filter((one) => one.measure === "totalPssKb" && one.key !== "push-settings/idle"),
      [
        { key: "only-before/idle", measure: "totalPssKb", unit: "KB", before: 1, after: null },
        { key: "only-after/idle", measure: "totalPssKb", unit: "KB", before: null, after: 1 },
      ],
    );
  });

  it("takes a soak scenario's last sample, after all its cycles", () => {
    const rows = compareMemory(
      [sample(0, { totalPssKb: 200_000 }), sample(30, { totalPssKb: 260_000 })],
      [sample(30, { totalPssKb: 210_000 }), sample(0, { totalPssKb: 200_000 })],
    );
    assert.deepEqual(rows, [
      {
        key: "soak-player/idle",
        measure: "totalPssKb",
        unit: "KB",
        before: 260_000,
        after: 210_000,
      },
    ]);
  });
});

describe("formatGrowth", () => {
  it("prints memory in MB and counts as they are", () => {
    const table = formatGrowth(
      memoryGrowth({
        memory: [
          sample(0, { totalPssKb: 204_800, views: 540 }),
          sample(1, { totalPssKb: 215_040, views: 540 }),
          sample(2, { totalPssKb: 225_280, views: 540 }),
        ],
        steps: [],
      }),
    );
    assert.match(
      table,
      /\| soak-player\/idle \| totalPssKb \| 3 \| 200\.0 MB \| 220\.0 MB \| \+20\.0 MB \| \+10\.0 MB \| still growing \|/,
    );
    assert.match(table, /\| soak-player\/idle \| views \| 3 \| 540 \| 540 \| 0 \| 0 \| flat \|/);
  });
});
