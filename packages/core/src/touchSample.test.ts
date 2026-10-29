import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  LONG_PRESS_SAMPLE_MENU,
  longPressFill,
  longPressHoldStep,
  type HeldFinger,
  type SampleTouch,
} from "./index.ts";

describe("the long-press sample's menu", () => {
  test("offers Play Next and Add to Queue as cards, then Add to Playlist", () => {
    assert.deepEqual(LONG_PRESS_SAMPLE_MENU, {
      cards: ["playNext", "addToQueue"],
      list: [{ action: "addToPlaylist", label: "Add to Playlist" }],
    });
  });
});

describe("the long-press sample's fill", () => {
  test("sweeps across the row for exactly the delay", () => {
    assert.deepEqual(longPressFill({ delayMs: 320, reduceMotion: false }), { durationMs: 320 });
  });

  test("doesn't sweep under reduce motion", () => {
    assert.equal(longPressFill({ delayMs: 320, reduceMotion: true }), null);
  });
});

describe("a hold on the long-press sample", () => {
  const first: SampleTouch = { id: 0, x: 100, y: 200 };
  const second: SampleTouch = { id: 1, x: 300, y: 600 };
  const held: HeldFinger = { id: 0, start: { x: 100, y: 200 } };

  test("starts when one finger goes down, sweeping the fill", () => {
    assert.deepEqual(
      longPressHoldStep(null, { kind: "start", touches: [first], changed: [first] }),
      {
        hold: held,
        fill: "start",
      },
    );
  });

  test("lasts while the finger stays within 10 dp of where it went down", () => {
    const moved = { ...first, x: 106, y: 208 };
    assert.deepEqual(
      longPressHoldStep(held, { kind: "move", touches: [moved], changed: [moved] }),
      {
        hold: held,
        fill: "keep",
      },
    );
  });

  test("is off once the finger drifts further, as the row's long-press is", () => {
    for (const moved of [
      { ...first, x: 107, y: 208 },
      { ...first, x: 89, y: 200 },
    ])
      assert.deepEqual(
        longPressHoldStep(held, { kind: "move", touches: [moved], changed: [moved] }),
        { hold: null, fill: "stop" },
      );
  });

  test("ends when its finger lifts or is cancelled", () => {
    for (const kind of ["end", "cancel"] as const)
      assert.deepEqual(longPressHoldStep(held, { kind, touches: [], changed: [first] }), {
        hold: null,
        fill: "stop",
      });
  });

  test("keeps running when a second finger goes down anywhere", () => {
    assert.deepEqual(
      longPressHoldStep(held, { kind: "start", touches: [first, second], changed: [second] }),
      { hold: held, fill: "keep" },
    );
  });

  test("measures drift from its own finger only", () => {
    const drifted = { ...second, x: 340 };
    assert.deepEqual(
      longPressHoldStep(held, { kind: "move", touches: [first, drifted], changed: [drifted] }),
      { hold: held, fill: "keep" },
    );
  });

  test("keeps running when a second finger lifts", () => {
    assert.deepEqual(
      longPressHoldStep(held, { kind: "end", touches: [first], changed: [second] }),
      { hold: held, fill: "keep" },
    );
  });

  test("doesn't start while other fingers are already down", () => {
    assert.deepEqual(
      longPressHoldStep(null, { kind: "start", touches: [first, second], changed: [second] }),
      { hold: null, fill: "keep" },
    );
  });

  test("does nothing once over", () => {
    for (const kind of ["move", "end", "cancel"] as const)
      assert.deepEqual(longPressHoldStep(null, { kind, touches: [first], changed: [first] }), {
        hold: null,
        fill: "keep",
      });
  });
});
