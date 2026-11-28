import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { createElement } from "react";
import { act, create } from "react-test-renderer";

import { loadWithStubs, stubModule } from "../perf/renderHarness.ts";

// A tapped tab's slide starts once the tab's first frame is drawn, so its motion doesn't share
// its first UI frames with the tab's attach, layout and draw (#1536). Until then the tab shows
// where the slide starts: half opaque, offset towards the tapped tab's side, never transparent.

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

type Timing = {
  to: number;
  config: { duration: number };
  done?: (finished: boolean) => void;
};

const harness = {
  reduceMotion: false,
  active: { id: 7 } as { id: number } | null,
  /** The UI thread's frame callbacks still waiting for a frame. */
  frames: [] as ((at: number) => void)[],
  /** Every timing animation started on a shared value. */
  timings: [] as Timing[],
  ended: [] as number[],
  motions: [] as [number, number][],
};
Object.assign(globalThis, { __tabEntryTest: harness });
const h = "globalThis.__tabEntryTest";
const react = JSON.stringify(import.meta.resolve("react"));

// The UI thread's requestAnimationFrame (a worklet's global).
Object.assign(globalThis, {
  requestAnimationFrame: (callback: (at: number) => void) => harness.frames.push(callback),
});
/** One UI frame at [at]: the callbacks waiting run, those they request wait for the next. */
const frame = (at: number) => {
  const due = harness.frames.splice(0);
  for (const callback of due) callback(at);
};

const [{ useTabEntry }] = await loadWithStubs<[typeof import("./tabEntry.ts")]>(
  [import.meta.resolve("./tabEntry.ts")],
  {
    "react-native-reanimated": stubModule(`
      import { useState } from ${react};
      const scope = ${h};
      export const useReducedMotion = () => scope.reduceMotion;
      export const useSharedValue = initial => useState(() => {
        let value = initial;
        return {
          get: () => value,
          set: next => {
            if (next !== null && typeof next === "object" && "timing" in next) {
              scope.timings.push(next.timing);
              value = next.timing.from ?? value;
            } else value = next;
          },
        };
      })[0];
      export const useAnimatedStyle = read => ({ get current() { return read(); } });
      export const withTiming = (to, config, done) => ({ timing: { to, config, done } });
    `),
    "react-native-worklets": stubModule(`
      export const scheduleOnUI = (work, ...args) => work(...args);
      export const scheduleOnRN = (work, ...args) => work(...args);
    `),
    "@/lib/timing": stubModule(`
      const scope = ${h};
      export const activeTiming = () => scope.active;
      export const timingTransitionEnd = id => scope.ended.push(id);
      export const timingMotionStarted = (id, at) => scope.motions.push([id, at]);
    `),
    "@/motion/entry": stubModule(`
      export const ENTRY = { ease: v => v, slide: 32, slideMs: 280, tabOpacity: 0.5, fadeMs: 150 };
    `),
    "@/settings/tabBar": stubModule(`
      const bar = ["index", "library", "playlists"];
      export const useTabBar = () => bar;
    `),
  },
);

type Entry = ReturnType<typeof useTabEntry>;
const Probe = ({ seen }: { seen: (entry: Entry) => void }) => {
  seen(useTabEntry());
  return null;
};
const mount = (): Entry => {
  const entries: Entry[] = [];
  act(() => {
    create(createElement(Probe, { seen: (entry) => entries.push(entry) }));
  });
  return entries.at(-1)!;
};
const look = (entry: Entry) => {
  const style = (entry.style as unknown as { current: Record<string, unknown> }).current;
  const [{ translateX }] = style.transform as [{ translateX: number }];
  return { opacity: style.opacity, translateX };
};

beforeEach(() => {
  harness.reduceMotion = false;
  harness.active = { id: 7 };
  harness.frames.length = 0;
  harness.timings.length = 0;
  harness.ended.length = 0;
  harness.motions.length = 0;
});

test("the tab rests in place until a tap brings it in", () => {
  const entry = mount();
  assert.deepEqual(look(entry), { opacity: 1, translateX: 0 });
});

test("a tapped tab shows at the slide's start for its first frame, and slides only after it's drawn", () => {
  const entry = mount();
  entry.enter("index", "library");

  // The commit showing the tab: its first frame is drawn at the slide's start, still.
  assert.deepEqual(look(entry), { opacity: 0.5, translateX: 32 });
  assert.equal(harness.timings.length, 0);
  frame(1000);
  assert.equal(harness.timings.length, 0, "the frame that attaches and draws the tab doesn't move");
  assert.deepEqual(look(entry), { opacity: 0.5, translateX: 32 });

  // The next frame comes once the first is drawn: the slide starts there.
  frame(1050);
  assert.equal(harness.timings.length, 1);
  assert.equal(harness.timings[0]!.to, 1);
  assert.equal(harness.timings[0]!.config.duration, 280);
  assert.deepEqual(harness.motions, [[7, 1050]], "the slide's frames are counted from its start");

  // The tab-switch timing still ends at the slide's end.
  assert.deepEqual(harness.ended, []);
  harness.timings[0]!.done!(true);
  assert.deepEqual(harness.ended, [7]);
});

test("the slide comes from the tapped tab's side", () => {
  const entry = mount();
  entry.enter("playlists", "index");
  assert.deepEqual(look(entry), { opacity: 0.5, translateX: -32 });
});

test("a newer tap takes over an entry still waiting for its first frame", () => {
  const entry = mount();
  entry.enter("index", "library");
  frame(1000);
  harness.active = { id: 8 };
  entry.enter("library", "playlists");
  frame(1016);
  frame(1033);
  frame(1050);
  assert.equal(harness.timings.length, 1, "only the last tab tapped slides");
  assert.deepEqual(harness.motions, [[8, 1033]]);
  harness.timings[0]!.done!(true);
  assert.deepEqual(harness.ended, [8]);
});

test("a slide cut short by another doesn't end the timing", () => {
  const entry = mount();
  entry.enter("index", "library");
  frame(1000);
  frame(1016);
  harness.timings[0]!.done!(false);
  assert.deepEqual(harness.ended, []);
});

test("with reduce motion the tab only fades, after its first frame too", () => {
  harness.reduceMotion = true;
  const entry = mount();
  entry.enter("index", "playlists");
  assert.deepEqual(look(entry), { opacity: 0.5, translateX: 0 });
  frame(1000);
  frame(1016);
  assert.equal(harness.timings[0]!.config.duration, 150);
});

test("with no tap being timed the tab still slides, and nothing is marked", () => {
  harness.active = null;
  const entry = mount();
  entry.enter("index", "library");
  frame(1000);
  frame(1016);
  assert.equal(harness.timings.length, 1);
  assert.deepEqual(harness.motions, []);
  harness.timings[0]!.done!(true);
  assert.deepEqual(harness.ended, []);
});
