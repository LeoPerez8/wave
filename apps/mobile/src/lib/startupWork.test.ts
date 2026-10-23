import assert from "node:assert/strict";
import { test } from "node:test";
import { createBackgroundWork } from "../../../../packages/core/src/backgroundWork.ts";
import { createTimingSession } from "./timingSession.ts";
import { createStartupWork } from "./startupWork.ts";

const setup = (intervalMs = 1000 / 60) => {
  let now = 0;
  let next = 0;
  const frames = new Map<number, () => void>();
  const tasks = new Map<number, () => void>();
  const session = createTimingSession({
    now: () => now,
    wallNow: () => now,
    write: () => {},
    context: () => ({ background: [], offline: true }),
    build: () => ({ version: "test", commit: "test" }),
  });
  const background = createBackgroundWork({
    now: () => now,
    schedule: (_ms, run) => {
      const id = ++next;
      tasks.set(id, run);
      return () => {
        tasks.delete(id);
      };
    },
  });
  const work = createStartupWork({
    now: () => now,
    intervalMs: () => intervalMs,
    isSettled: session.isSettled,
    subscribe: session.onSettled,
    request: (run) => {
      const id = ++next;
      frames.set(id, run);
      return id;
    },
    cancel: (id) => {
      frames.delete(id);
    },
    whenFree: background.whenFree,
  });
  const frame = (ms = 16) => {
    now += ms;
    const due = [...frames.values()];
    frames.clear();
    for (const run of due) run();
  };
  const task = () => {
    const first = tasks.entries().next().value;
    if (first) {
      tasks.delete(first[0]);
      first[1]();
    }
  };
  const settle = (id: number) => {
    session.response(id);
    session.frame(id);
    session.content(id);
    session.end(id);
  };
  return {
    work,
    session,
    frame,
    task,
    settle,
    frames,
    tasks,
    advance: (ms: number) => {
      now += ms;
    },
  };
};

test("startup waits for actual cold-screen settlement and three quiet frame intervals, in registration order", () => {
  const h = setup();
  const started: string[] = [];
  const id = h.session.routeCommitted("/")!;
  for (const name of ["scan", "imports", "ytLibraryImport"])
    h.work.whenFree(() => started.push(name));
  h.session.response(id);
  h.session.frame(id);
  h.session.content(id);
  h.advance(10_000);
  h.task();
  h.frame();
  assert.deepEqual(started, []); // Content and even the old cap cannot release startup.
  h.session.end(id);
  h.frame();
  h.frame();
  h.frame();
  h.task();
  assert.deepEqual(started, []);
  h.frame();
  h.task();
  assert.deepEqual(started, ["scan"]);
  h.task();
  assert.deepEqual(started, ["scan", "imports"]);
  h.task();
  assert.deepEqual(started, ["scan", "imports", "ytLibraryImport"]);
  assert.equal(h.frames.size, 0);
});

test("navigation cancels an outstanding free turn and requires the new screen plus a fresh quiet window", () => {
  const h = setup();
  const started: string[] = [];
  h.settle(h.session.routeCommitted("/")!);
  h.work.whenFree(() => started.push("scan"));
  for (let i = 0; i < 4; i++) h.frame();
  assert.equal(h.tasks.size, 1);
  const next = h.session.begin("push", "/album/2");
  assert.equal(h.tasks.size, 0);
  assert.equal(h.frames.size, 0);
  h.frame();
  h.task();
  assert.deepEqual(started, []);
  h.settle(next);
  h.frame();
  h.frame();
  h.frame();
  h.task();
  assert.deepEqual(started, []);
  h.frame();
  h.task();
  assert.deepEqual(started, ["scan"]);
});

test("a busy frame restarts quietness and cancelled work leaves no frames or timers", () => {
  const h = setup();
  let work = 0;
  h.settle(h.session.routeCommitted("/")!);
  const cancel = h.work.whenFree(() => work++);
  h.frame();
  h.frame();
  h.frame(50);
  h.frame();
  h.frame();
  h.task();
  assert.equal(work, 0);
  h.frame();
  cancel();
  h.task();
  assert.equal(work, 0);
  assert.equal(h.tasks.size, 0);
  assert.equal(h.frames.size, 0);
  h.work.whenFree(() => work++);
  h.frame();
  h.frame();
  h.frame();
  h.task();
  assert.equal(work, 0);
  h.frame();
  h.task();
  assert.equal(work, 1);
});

test("a new job after idle and a delayed free turn must recheck quietness", () => {
  const h = setup();
  let work = 0;
  h.settle(h.session.routeCommitted("/")!);
  h.work.whenFree(() => work++);
  for (let i = 0; i < 4; i++) h.frame();
  h.advance(100);
  h.task();
  assert.equal(work, 0);
  for (let i = 0; i < 4; i++) h.frame();
  h.task();
  assert.equal(work, 1);
  h.advance(100);
  h.work.whenFree(() => work++);
  h.task();
  assert.equal(work, 1);
  for (let i = 0; i < 4; i++) h.frame();
  h.task();
  assert.equal(work, 2);
});

test("a throwing job still gives the next job its own turn", () => {
  const h = setup();
  let work = 0;
  h.settle(h.session.routeCommitted("/")!);
  h.work.whenFree(() => {
    throw new Error("source failed");
  });
  h.work.whenFree(() => work++);
  for (let i = 0; i < 4; i++) h.frame();
  assert.throws(h.task, /source failed/);
  assert.equal(work, 0);
  h.task();
  assert.equal(work, 1);
});

test("quietness follows the actual display cadence at 30, 90 and 120Hz", () => {
  for (const hz of [30, 90, 120]) {
    const interval = 1000 / hz;
    const h = setup(interval);
    let starts = 0;
    h.settle(h.session.routeCommitted("/")!);
    h.work.whenFree(() => starts++);
    h.frame(interval);
    h.frame(interval);
    h.frame(interval * 2);
    h.frame(interval);
    h.frame(interval);
    h.task();
    assert.equal(starts, 0);
    h.frame(interval);
    h.task();
    assert.equal(starts, 1);
  }
});

test("backgrounding cancels a queued start and requires actual foreground settlement before a new quiet window", () => {
  const h = setup();
  let starts = 0;
  h.settle(h.session.routeCommitted("/")!);
  h.work.whenFree(() => starts++);
  for (let i = 0; i < 4; i++) h.frame();
  assert.equal(h.tasks.size, 1);
  h.session.cancel(); // timing.ts uses this exact boundary on AppState leaving active.
  assert.equal(h.tasks.size, 0);
  assert.equal(h.frames.size, 0);
  h.advance(60_000);
  h.frame();
  h.task();
  assert.equal(starts, 0);
  const resumed = h.session.routeCommitted("/")!;
  h.session.frame(resumed);
  h.session.end(resumed);
  h.frame();
  h.task();
  assert.equal(starts, 0); // Foreground commit alone does not mean content was drawn.
  h.session.content(resumed);
  for (let i = 0; i < 3; i++) h.frame();
  h.task();
  assert.equal(starts, 0);
  h.frame();
  h.task();
  assert.equal(starts, 1);
  assert.equal(h.frames.size, 0);
  assert.equal(h.tasks.size, 0);
  h.work.dispose();
});
