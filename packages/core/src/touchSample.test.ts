import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { LONG_PRESS_SAMPLE_MENU, longPressFill, longPressHoldLasts } from "./index.ts";

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
  const start = { x: 100, y: 200 };

  test("lasts while the finger stays within 10 dp of where it went down", () => {
    assert.equal(longPressHoldLasts(start, { x: 106, y: 208 }), true);
  });

  test("is off once the finger drifts further, as the row's long-press is", () => {
    assert.equal(longPressHoldLasts(start, { x: 107, y: 208 }), false);
    assert.equal(longPressHoldLasts(start, { x: 89, y: 200 }), false);
  });
});
