import assert from "node:assert/strict";
import { test } from "node:test";
import { assertWindowReady, assessFrames, processTreeMemory } from "../scripts/performance.ts";

test("window readiness must be strictly below two seconds, including launch time", () => {
  assert.doesNotThrow(() => assertWindowReady(1999));
  assert.throws(() => assertWindowReady(2000), /2000/);
  assert.throws(() => assertWindowReady(2500), /2500/);
  assert.throws(() => assertWindowReady(Number.NaN));
});

test("resting memory includes all descendants once, including JVM and audio, and excludes other apps", () => {
  const sample = processTreeMemory(10, [
    { pid: 42, parentPid: 20, name: "java", rssBytes: 30 },
    { pid: 10, parentPid: 1, name: "electron", rssBytes: 100 },
    { pid: 20, parentPid: 10, name: "electron", rssBytes: 50 },
    { pid: 30, parentPid: 10, name: "wave-audio", rssBytes: 25 },
    { pid: 99, parentPid: 1, name: "other-wave", rssBytes: 999 },
  ]);
  assert.equal(sample.totalRssBytes, 205);
  assert.deepEqual(
    sample.processes.map((p) => p.pid),
    [10, 20, 30, 42],
  );
  assert.throws(() => processTreeMemory(11, []), /Missing/);
});

test("scrolling keeps the display cadence and rejects dropped frames and empty viewports", () => {
  const display = Array<number>(60).fill(1000 / 60);
  const smooth = assessFrames(display, Array<number>(120).fill(1000 / 60), 0);
  assert.equal(smooth.passed, true);
  assert.equal(smooth.missedFrameRatio, 0);
  // A 30 fps table on a 60 Hz display must fail, even though it is well below 100 ms.
  assert.equal(assessFrames(display, Array<number>(120).fill(1000 / 30), 0).passed, false);
  const hitch = Array<number>(120).fill(1000 / 60);
  hitch[60] = 250;
  assert.equal(assessFrames(display, hitch, 0).passed, false);
  assert.equal(assessFrames(display, Array<number>(120).fill(1000 / 60), 12).passed, false);
  assert.throws(() => assessFrames([], [], 0));
  assert.throws(() => assessFrames(Array<number>(60).fill(100), display, 0));
});
