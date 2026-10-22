import assert from "node:assert/strict";
import { test } from "node:test";
import { lateFrame } from "./index.ts";

test("late means strictly over 1.5 actual display intervals at 60, 90 and 120 Hz", () => {
  for (const hz of [60, 90, 120]) {
    const interval = 1000 / hz;
    assert.equal(lateFrame(interval, interval), false);
    assert.equal(lateFrame(interval * 1.5, interval), false);
    assert.equal(lateFrame(interval * 1.5 + 0.001, interval), true);
    assert.equal(lateFrame(20, interval), hz !== 60);
  }
  assert.equal(lateFrame(100, 0), false);
  assert.equal(lateFrame(-1, 10), false);
});

test("recovered hitches include their route and optional main stack; freezes have their own lines", async () => {
  const { hitchLine } = await import("./index.ts");
  assert.equal(hitchLine("JS", 499, "/a"), null);
  assert.equal(hitchLine("JS", 500, "/a"), "JS thread busy 0.5 s on /a");
  assert.equal(hitchLine("JS", 800, "/a"), "JS thread busy 0.8 s on /a");
  assert.equal(
    hitchLine("main", 2999, "/a", "at scan\nat query"),
    "main thread busy 3.0 s on /a\nat scan\nat query",
  );
  assert.equal(hitchLine("JS", 3000, "/a"), null);
  assert.equal(hitchLine("JS", 1150, "/a"), "JS thread busy 1.2 s on /a");
  assert.equal(hitchLine("main", 1100), "main thread busy 1.1 s");
});

test("each frame lane names the transition, late callback count and longest gap; smooth is silent", async () => {
  const { missedFramesLine } = await import("./index.ts");
  assert.equal(
    missedFramesLine({ kind: "push", to: "/album/88" }, "JS", { count: 0, longestGapMs: 16 }),
    null,
  );
  assert.equal(
    missedFramesLine({ kind: "push", to: "/album/88" }, "JS", { count: 7, longestGapMs: 210 }),
    "Push to /album/88 missed 7 frames (longest gap 210 ms; JS)",
  );
  assert.equal(
    missedFramesLine({ kind: "nowPlayingOpen", to: "Now Playing" }, "UI", {
      count: 1,
      longestGapMs: 1100,
    }),
    "Now Playing open to Now Playing missed 1 frames (longest gap 1.1 s; UI)",
  );
});
