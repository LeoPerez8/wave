import assert from "node:assert/strict";
import { test } from "node:test";
import { createTransitionFrames } from "./transitionFrames.ts";
import { createTimingSession } from "./timingSession.ts";

test("a real session collects only tap-to-settled frames, including the blocked first callback", async () => {
  let now = 0;
  let next = 0;
  const callbacks = new Map<number, () => void>();
  const lines: string[] = [];
  const session = createTimingSession({
    now: () => now,
    wallNow: () => 0,
    write: (line) => lines.push(line),
    context: () => ({ background: [], offline: false }),
    build: () => ({ version: "test", commit: "abc" }),
  });
  const reports: unknown[] = [];
  const collector = createTransitionFrames({
    now: () => now,
    request: (cb) => {
      callbacks.set(++next, cb);
      return next;
    },
    cancel: (id) => {
      callbacks.delete(id);
    },
    intervalMs: () => 1000 / 120,
    uiStart: () => {},
    uiStop: async () => ({ count: 2, longestGapMs: 30 }),
    report: (event, lane, frames) => {
      reports.push([event.to, lane, { count: frames.count, longestGapMs: frames.longestGapMs }]);
      session.frames(event.id, frames.count);
    },
  });
  const unsubscribe = session.onTransition(collector.transition);
  assert.equal(callbacks.size, 0);
  const id = session.begin("push", "/album/88");
  now = 40;
  const callback = callbacks.values().next().value!;
  callbacks.clear();
  callback();
  now = 45;
  session.response(id);
  session.frame(id);
  session.content(id);
  session.end(id);
  await collector.flush();
  assert.equal(callbacks.size, 0);
  assert.deepEqual(reports, [
    ["/album/88", "JS", { count: 1, longestGapMs: 40 }],
    ["/album/88", "UI", { count: 2, longestGapMs: 30 }],
  ]);
  session.leave();
  assert.match(lines[0]!, /missed frames 3/);
  unsubscribe();
  collector.dispose();
});

test("background cancellation, overlapping taps and stale callbacks cannot leak work into the next transition", async () => {
  let now = 0;
  let next = 0;
  let observed = 0;
  const callbacks = new Map<number, () => void>();
  const reports: string[] = [];
  const stops: number[] = [];
  const collector = createTransitionFrames({
    now: () => now,
    request: (cb) => {
      callbacks.set(++next, cb);
      return next;
    },
    cancel: (id) => {
      callbacks.delete(id);
    },
    intervalMs: () => 1000 / 90,
    uiStart: () => {},
    uiStop: async (id) => {
      stops.push(id);
      return { count: 5, longestGapMs: 100 };
    },
    observe: () => {
      observed++;
      return () => {
        observed--;
      };
    },
    report: (event, lane) => reports.push(`${event.id}:${lane}`),
  });
  const event = (id: number, phase: "start" | "settled" | "cancelled") => ({
    id,
    at: now,
    phase,
    kind: "push" as const,
    from: "/",
    to: "/next",
  });
  collector.transition(event(1, "start"));
  const stale = callbacks.values().next().value!;
  now = 100;
  collector.transition(event(2, "start"));
  stale();
  assert.equal(callbacks.size, 1);
  assert.equal(observed, 1);
  collector.transition(event(1, "settled"));
  collector.transition(event(2, "cancelled")); // AppState background uses this same boundary.
  await collector.flush();
  assert.deepEqual(reports, []);
  assert.deepEqual(stops, [1, 2]);
  assert.equal(callbacks.size, 0);
  assert.equal(observed, 0);
  collector.transition(event(3, "start"));
  collector.dispose();
  await collector.flush();
  assert.equal(callbacks.size, 0);
  assert.equal(observed, 0);
  assert.deepEqual(reports, []);
});

test("live cadence changes apply to both smooth frames and a final stall, with no rest sampling", async () => {
  let now = 0;
  let hz = 60;
  let callback: (() => void) | null = null;
  const reports: { count: number; longestGapMs: number }[] = [];
  const collector = createTransitionFrames({
    now: () => now,
    request: (cb) => {
      callback = cb;
      return 1;
    },
    cancel: () => {
      callback = null;
    },
    intervalMs: () => 1000 / hz,
    uiStart: () => {},
    uiStop: async () => null,
    report: (_event, _lane, frames) =>
      reports.push({ count: frames.count, longestGapMs: frames.longestGapMs }),
  });
  const event = { id: 1, at: 0, kind: "tab" as const, from: "/", to: "/songs" };
  collector.transition({ ...event, phase: "start" });
  now = 20;
  callback!(); // On time at 60 Hz.
  hz = 120;
  now = 40;
  callback!(); // Same gap is late at 120 Hz.
  now = 80;
  collector.transition({ ...event, phase: "settled" }); // No next rAF needed to notice the tail.
  await collector.flush();
  assert.deepEqual(reports, [{ count: 2, longestGapMs: 40 }]);
  assert.equal(callback, null);
  collector.dispose();
});

test("longest gap remains the actual longest when display cadence changes", async () => {
  let now = 0;
  let hz = 120;
  let callback: (() => void) | null = null;
  let result: unknown;
  const collector = createTransitionFrames({
    now: () => now,
    request: (cb) => {
      callback = cb;
      return 1;
    },
    cancel: () => {
      callback = null;
    },
    intervalMs: () => 1000 / hz,
    uiStart: () => {},
    uiStop: async () => null,
    report: (_event, _lane, frames) => {
      result = { count: frames.count, longestGapMs: frames.longestGapMs };
    },
  });
  const event = { id: 1, at: 0, kind: "push" as const, from: "/", to: "/next" };
  collector.transition({ ...event, phase: "start" });
  now = 16;
  callback!(); // Late at 120 Hz.
  hz = 60;
  now = 36;
  callback!(); // Longer, but on time at 60 Hz.
  collector.transition({ ...event, phase: "settled" });
  await collector.flush();
  assert.deepEqual(result, { count: 1, longestGapMs: 20 });
});

test("background summary waits for a settled UI report and cancels the next unfinished tap", async () => {
  let now = 0;
  let callback: (() => void) | null = null;
  let resolveUi!: (frames: { count: number; longestGapMs: number }) => void;
  const uiResult = new Promise<{ count: number; longestGapMs: number }>((resolve) => {
    resolveUi = resolve;
  });
  const lines: string[] = [];
  const session = createTimingSession({
    now: () => now,
    wallNow: () => 0,
    write: (line) => lines.push(line),
    context: () => ({ background: [], offline: false }),
    build: () => ({ version: "test", commit: "abc" }),
  });
  const collector = createTransitionFrames({
    now: () => now,
    request: (cb) => {
      callback = cb;
      return 1;
    },
    cancel: () => {
      callback = null;
    },
    intervalMs: () => 1000 / 60,
    uiStart: () => {},
    uiStop: (id) => (id === 1 ? uiResult : Promise.resolve(null)),
    report: (event, _lane, totals) => session.frames(event.id, totals.count),
  });
  session.onTransition(collector.transition);
  const settled = session.begin("push", "/album/88");
  now = 10;
  session.response(settled);
  session.frame(settled);
  session.content(settled);
  session.end(settled);
  session.begin("push", "/unfinished");
  now = 5000;
  session.cancel(); // The real AppState adapter cancels before flushing its collection.
  const summary = collector.flush().then(() => session.leave());
  assert.equal(callback, null);
  assert.deepEqual(lines, []);
  resolveUi({ count: 2, longestGapMs: 30 });
  await summary;
  assert.match(lines[0]!, /2 taps/);
  assert.match(lines[0]!, /screen \/album\/88 content median 10 ms p90 10 ms, missed frames 2/);
  assert.doesNotMatch(lines[0]!, /screen \/unfinished/);
  collector.dispose();
});
