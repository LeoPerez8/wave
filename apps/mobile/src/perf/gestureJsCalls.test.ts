import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";

import { gestureJsCalls, mobileSources } from "./sourceAudit.mjs";

/**
 * Performance rule 7 (docs/spec.md › Fluidity): a gesture runs on the UI
 * thread and calls JS only when its outcome changes (the page a swipe is on,
 * the letter under a finger), never on every frame it moves (#1380). A call
 * into JS from a handler that runs every frame sits under the condition that
 * says the outcome changed.
 */
test("gestures and scrolls call JS only when their outcome changes", () => {
  assert.deepEqual(
    gestureJsCalls(mobileSources(join(import.meta.dirname, ".."))),
    [],
    "call scheduleOnRN only when what the gesture decides has changed",
  );
});

test("a call into JS on every frame of a gesture is caught", () => {
  assert.deepEqual(
    gestureJsCalls({
      "motion/Drag.tsx": `
        const Drag = () => {
          const pan = usePanGesture({
            onActivate: () => { "worklet"; scheduleOnRN(began); },
            onUpdate: (event) => { "worklet"; offset.set(event.translationX); scheduleOnRN(moved, event.translationX); },
            onDeactivate: () => { "worklet"; scheduleOnRN(ended); },
          });
          const tap = Gesture.Pan().onChange((event) => runOnJS(moved)(event.x));
          const onScroll = useAnimatedScrollHandler((event) => {
            scheduleOnRN(scrolled, event.contentOffset.x);
          });
          const config = useAnimatedScrollHandler({ onScroll(event) { scheduleOnRN(scrolled, 0); } });
          useAnimatedReaction(() => progress.get(), (next) => scheduleOnRN(follow, next));
        };`,
    }),
    [
      "motion/Drag.tsx#Drag: onUpdate scheduleOnRN(moved, event.translationX)",
      "motion/Drag.tsx#Drag: onChange runOnJS(moved)",
      "motion/Drag.tsx#Drag: useAnimatedScrollHandler scheduleOnRN(scrolled, event.contentOffset.x)",
      "motion/Drag.tsx#Drag: onScroll scheduleOnRN(scrolled, 0)",
      "motion/Drag.tsx#Drag: useAnimatedReaction scheduleOnRN(follow, next)",
    ],
  );
});

test("a call into JS when the outcome changes passes", () => {
  assert.deepEqual(
    gestureJsCalls({
      "motion/Pager.tsx": `
        const Pager = () => {
          const onScroll = useAnimatedScrollHandler((event) => {
            const now = Math.round(event.contentOffset.x / width);
            if (now === at.get()) return;
            at.set(now);
            scheduleOnRN(onIndex, now);
          });
          const pan = usePanGesture({
            onUpdate: (event) => {
              "worklet";
              if (armed(event) !== was.get()) scheduleOnRN(arm, armed(event));
              offset.set(withSpring(0, {}, (done) => { scheduleOnRN(settled); }));
            },
          });
          useAnimatedReaction(() => line.get(), (next, previous) => next !== previous && scheduleOnRN(show, next));
        };`,
    }),
    [],
  );
});
