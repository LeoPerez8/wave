import assert from "node:assert/strict";
import { test } from "node:test";
import type { PositionReport, SleepTimer } from "@wave/core";
import { makeExternalStore } from "../lib/externalStore.ts";
import { observePlayhead } from "./playheadSource.ts";

const setup = () => {
  const reports = makeExternalStore<PositionReport>({
    positionMs: 30_000,
    durationMs: 200_000,
    at: 1_000,
    isPlaying: true,
  });
  const shown = makeExternalStore(false);
  const active = makeExternalStore(true);
  const timer = makeExternalStore<SleepTimer | null>(null);
  const frames: { report: PositionReport; now: number }[] = [];
  let live = false;
  let ticking = false;
  let now = 1_500;
  const stop = observePlayhead(
    { reports, shown, active, timer },
    {
      report: (report, at) => frames.push({ report, now: at }),
      live: (value) => {
        live = value;
      },
      ticking: (value) => {
        ticking = value;
      },
    },
    () => now,
  );
  return {
    reports,
    shown,
    active,
    timer,
    frames,
    stop,
    live: () => live,
    ticking: () => ticking,
    time: (value: number) => {
      now = value;
    },
  };
};

test("the playhead follows reports only while Now Playing is shown and the app is active", () => {
  const h = setup();
  assert.equal(h.live(), false);
  assert.equal(h.ticking(), false);
  assert.equal(h.reports.listenerCount(), 0);
  h.shown.set(true);
  assert.equal(h.live(), true);
  assert.equal(h.ticking(), true);
  assert.equal(h.reports.listenerCount(), 1);
  assert.equal(h.frames.length, 1);
  h.active.set(false);
  assert.equal(h.live(), false);
  assert.equal(h.ticking(), false);
  assert.equal(h.reports.listenerCount(), 0);
  h.reports.update((r) => ({ ...r, positionMs: 50_000, at: 21_000 }));
  assert.equal(h.frames.length, 1);
  h.time(21_500);
  h.active.set(true);
  assert.deepEqual(h.frames.at(-1), { report: h.reports.get(), now: 21_500 });
  h.shown.set(false);
  assert.equal(h.ticking(), false);
  assert.equal(h.reports.listenerCount(), 0);
  h.stop();
  assert.equal(h.active.listenerCount(), 0);
  assert.equal(h.shown.listenerCount(), 0);
});

test("a paused deadline still counts down; End of track and no timer need no frames", () => {
  const h = setup();
  h.reports.update((r) => ({ ...r, isPlaying: false }));
  h.shown.set(true);
  assert.equal(h.ticking(), false);
  h.timer.set({ type: "deadline", endsAt: 61_500 });
  assert.equal(h.ticking(), true);
  h.timer.set({ type: "endOfTrack" });
  assert.equal(h.ticking(), false);
  h.timer.set(null);
  assert.equal(h.ticking(), false);
  h.active.set(false);
  h.timer.set({ type: "deadline", endsAt: 61_500 });
  assert.equal(h.ticking(), false);
  assert.equal(h.timer.listenerCount(), 0);
  h.active.set(true);
  assert.equal(h.ticking(), true);
  h.stop();
  assert.equal(h.ticking(), false);
  assert.equal(h.timer.listenerCount(), 0);
});

test("seek, pause, and a song change replace the report immediately without restarting the source", () => {
  const h = setup();
  h.shown.set(true);
  h.time(2_000);
  h.reports.update((r) => ({ ...r, positionMs: 120_000, at: 2_000 }));
  assert.deepEqual(h.frames.at(-1), { report: h.reports.get(), now: 2_000 });
  h.reports.update((r) => ({ ...r, isPlaying: false }));
  assert.equal(h.ticking(), false);
  h.reports.set({ positionMs: 0, durationMs: null, at: 3_000, isPlaying: true });
  assert.equal(h.ticking(), true);
  assert.equal(h.frames.at(-1)?.report.durationMs, null);
  assert.equal(h.frames.at(-1)?.report.positionMs, 0);
  assert.equal(h.reports.listenerCount(), 1);
  h.stop();
  const count = h.frames.length;
  h.reports.update((r) => ({ ...r, positionMs: 90_000 }));
  h.active.set(false);
  h.shown.set(false);
  assert.equal(h.frames.length, count);
  assert.equal(h.live(), false);
  assert.equal(h.ticking(), false);
});
