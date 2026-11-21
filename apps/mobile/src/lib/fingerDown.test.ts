import assert from "node:assert/strict";
import { test } from "node:test";

import { createFingerDown } from "./fingerDown.ts";

const harness = () => {
  const timers: { run: () => void; ms: number; cancelled: boolean }[] = [];
  const finger = createFingerDown({
    takeoverMs: 3000,
    schedule: (ms, run) => {
      const timer = { run, ms, cancelled: false };
      timers.push(timer);
      return () => {
        timer.cancelled = true;
      };
    },
  });
  const changes: boolean[] = [];
  finger.subscribe(() => changes.push(finger.isDown()));
  const elapse = () => {
    for (const timer of timers.splice(0)) if (!timer.cancelled) timer.run();
  };
  return { finger, changes, timers, elapse };
};

test("a finger is down from the touch's start until it lifts", () => {
  const { finger, changes } = harness();
  assert.equal(finger.isDown(), false);
  finger.started();
  assert.equal(finger.isDown(), true);
  finger.ended();
  assert.equal(finger.isDown(), false);
  assert.deepEqual(changes, [true, false]);
});

test("a second finger's start tells no one again", () => {
  const { finger, changes } = harness();
  finger.started();
  finger.started();
  assert.deepEqual(changes, [true]);
});

test("a touch taken over counts as down until the takeover wait ends", () => {
  const { finger, timers, elapse } = harness();
  finger.started();
  finger.takenOver();
  assert.equal(finger.isDown(), true);
  assert.equal(timers[0]?.ms, 3000);
  elapse();
  assert.equal(finger.isDown(), false);
});

test("the next touch's lift ends a taken-over touch early", () => {
  const { finger, timers, changes } = harness();
  finger.started();
  finger.takenOver();
  finger.started();
  finger.ended();
  assert.equal(finger.isDown(), false);
  assert.equal(timers[0]?.cancelled, true);
  assert.deepEqual(changes, [true, false]);
});

test("an unsubscribed listener hears nothing more", () => {
  const { finger } = harness();
  let heard = 0;
  const stop = finger.subscribe(() => heard++);
  finger.started();
  stop();
  finger.ended();
  assert.equal(heard, 1);
});
