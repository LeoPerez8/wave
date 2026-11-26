import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { GHOST_WAVE, ghostWaveFrame, ghostWavePeriodMs } from "./index.ts";

const bar = { from: 100, to: 300, wavelength: 16, amplitude: 2.5 };

/** The x and y of each point of [d]. */
const points = (d: string): Array<[number, number]> =>
  [...d.matchAll(/[ML](-?[\d.]+) (-?[\d.]+)/g)].map((m) => [Number(m[1]), Number(m[2])]);

describe("ghostWaveFrame", () => {
  test("leaves the playhead and stays on the remaining line", () => {
    for (const phase of [0.05, 0.3, 0.6, 0.95]) {
      const xs = points(ghostWaveFrame({ ...bar, phase }).d).map(([x]) => x);
      assert.ok(Math.min(...xs) >= bar.from, `phase ${phase} starts at the playhead or after`);
      assert.ok(Math.max(...xs) <= bar.to, `phase ${phase} stays inside the bar`);
    }
  });

  test("its head travels right", () => {
    const head = (phase: number) =>
      Math.max(...points(ghostWaveFrame({ ...bar, phase }).d).map(([x]) => x));
    assert.ok(head(0.2) < head(0.5));
    assert.ok(head(0.5) < head(0.8));
  });

  test("is about 70dp long", () => {
    const xs = points(ghostWaveFrame({ ...bar, phase: 0.7 }).d).map(([x]) => x);
    assert.equal(Math.round(Math.max(...xs) - Math.min(...xs)), GHOST_WAVE.length);
  });

  test("fades from 55% to nothing and is gone by the end", () => {
    assert.ok(Math.abs(ghostWaveFrame({ ...bar, phase: 0.01 }).opacity - 0.55) < 0.01);
    assert.ok(ghostWaveFrame({ ...bar, phase: 0.5 }).opacity < 0.3);
    assert.equal(ghostWaveFrame({ ...bar, phase: 1 }).opacity, 0);
  });

  test("starts at 1.5× the scrubber's amplitude and shrinks to about 40%", () => {
    const peak = (phase: number) =>
      Math.max(...points(ghostWaveFrame({ ...bar, phase }).d).map(([, y]) => Math.abs(y)));
    assert.ok(peak(0.4) <= bar.amplitude * 1.5);
    assert.ok(peak(0.4) > bar.amplitude);
    assert.ok(peak(0.999) <= bar.amplitude * 1.5 * 0.41);
  });

  test("its tail flattens behind it", () => {
    const pts = points(ghostWaveFrame({ ...bar, phase: 0.8 }).d);
    assert.ok(Math.abs(pts[0]![1]) < 0.1);
  });

  test("a playhead at the end leaves no room: nothing to draw", () => {
    assert.deepEqual(ghostWaveFrame({ ...bar, from: 300, phase: 0.5 }), { d: "", opacity: 0 });
  });
});

describe("ghostWavePeriodMs", () => {
  test("every 2.4 s Offline, every 3.6 s Slow, not otherwise", () => {
    assert.equal(ghostWavePeriodMs("offline"), 2400);
    assert.equal(ghostWavePeriodMs("slow"), 3600);
    assert.equal(ghostWavePeriodMs("playing"), null);
    assert.equal(ghostWavePeriodMs("back"), null);
  });
});
