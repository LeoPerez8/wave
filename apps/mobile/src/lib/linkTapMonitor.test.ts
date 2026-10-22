import assert from "node:assert/strict";
import test from "node:test";
import { createLinkTapMonitor } from "./linkTapMonitor.ts";

test("a link with no navigation warns exactly once at one second, with its latest reason", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const warnings: string[] = [];
  const monitor = createLinkTapMonitor({
    later: (callback, ms) => setTimeout(callback, ms),
    cancel: clearTimeout,
    lost: (line) => warnings.push(line),
  });
  monitor.begin(1, { kind: "artistLink", from: "Now Playing", to: "Björk" });
  monitor.reason(1, "link not ready");
  t.mock.timers.tick(999);
  assert.deepEqual(warnings, []);
  t.mock.timers.tick(1);
  assert.deepEqual(warnings, [
    "Lost artist link to Björk from Now Playing: no navigation after 1 s; link not ready",
  ]);
  t.mock.timers.tick(1000);
  assert.equal(warnings.length, 1);
});

test("two links retain independent deadlines; closing cannot lose an accepted push", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const warnings: string[] = [];
  const monitor = createLinkTapMonitor({
    later: (callback, ms) => setTimeout(callback, ms),
    cancel: clearTimeout,
    lost: (line) => warnings.push(line),
  });
  monitor.begin(1, { kind: "artistLink", from: "Now Playing", to: "First" });
  monitor.navigated(1);
  t.mock.timers.tick(10);
  monitor.begin(2, { kind: "albumLink", from: "Now Playing", to: "Second" });
  monitor.closeTakenOver("Back");
  t.mock.timers.tick(990);
  assert.deepEqual(warnings, []);
  t.mock.timers.tick(10);
  assert.deepEqual(warnings, [
    "Lost album link to Second from Now Playing: no navigation after 1 s; close taken over by Back",
  ]);
});

test("target and readiness failures explain missing navigation; a choice destination cancels its warning", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const warnings: string[] = [];
  const monitor = createLinkTapMonitor({
    later: (callback, ms) => setTimeout(callback, ms),
    cancel: clearTimeout,
    lost: (line) => warnings.push(line),
  });
  for (const id of [1, 2, 3, 4, 5])
    monitor.begin(id, { kind: "artistLink", from: "Now Playing", to: String(id) });
  monitor.reason(1, "target gone");
  monitor.closeTakenOver("chevron");
  monitor.reason(3, "link not ready");
  monitor.navigated(4); // The artist-choice card opened: a later dismissal is intentional.
  monitor.reason(5, "close taken over by card");
  t.mock.timers.tick(1000);
  assert.equal(warnings.length, 4);
  assert.match(warnings[0]!, /target gone$/);
  assert.match(warnings[1]!, /close taken over by chevron$/);
  assert.match(warnings[2]!, /link not ready$/);
  assert.match(warnings[3]!, /close taken over by card$/);
  monitor.navigated(1); // A late destination doesn't erase or repeat the warning.
  t.mock.timers.tick(1000);
  assert.equal(warnings.length, 4);
});

test("a tap that reaches no known outcome reports unknown", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const warnings: string[] = [];
  const monitor = createLinkTapMonitor({
    later: (callback, ms) => setTimeout(callback, ms),
    cancel: clearTimeout,
    lost: (line) => warnings.push(line),
  });
  monitor.begin(1, { kind: "albumLink", from: "Now Playing", to: "Album" });
  t.mock.timers.tick(1000);
  assert.match(warnings[0]!, /unknown$/);
});
