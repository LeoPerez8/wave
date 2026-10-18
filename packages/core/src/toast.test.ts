import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { toastDuration, toastSwipeDismisses } from "./index.ts";

describe("toastDuration", () => {
  test("keeps a short line up for four seconds", () => {
    assert.equal(toastDuration("Fixed “Airbag”"), 4_000);
    assert.equal(toastDuration("x".repeat(40)), 4_000);
  });

  test("gives a longer line time to be read, 50 ms a character past the fortieth", () => {
    assert.equal(toastDuration("x".repeat(80)), 6_000);
  });

  test("never keeps a line up past eight seconds", () => {
    assert.equal(toastDuration("x".repeat(400)), 8_000);
  });

  test("gives a line with an action two seconds more, to reach the button", () => {
    assert.equal(toastDuration("New queue playing", { action: "Undo" }), 6_000);
    assert.equal(toastDuration("x".repeat(80), { action: "Undo" }), 8_000);
    assert.equal(toastDuration("x".repeat(400), { action: "Undo" }), 8_000);
  });
});

describe("toastSwipeDismisses", () => {
  const still = { translationX: 0, translationY: 0, velocityX: 0, velocityY: 0 };
  const pill = { width: 240, height: 48 };

  test("sends the toast away on a drag a third of the way across, either way", () => {
    assert.equal(toastSwipeDismisses({ ...still, ...pill, translationX: 80 }), true);
    assert.equal(toastSwipeDismisses({ ...still, ...pill, translationX: -80 }), true);
    assert.equal(toastSwipeDismisses({ ...still, ...pill, translationX: 40 }), false);
  });

  test("sends it away on a drag down a third of its height, or a flick down", () => {
    assert.equal(toastSwipeDismisses({ ...still, ...pill, translationY: 16 }), true);
    assert.equal(toastSwipeDismisses({ ...still, ...pill, translationY: 10 }), false);
    assert.equal(
      toastSwipeDismisses({ ...still, ...pill, translationY: 18, velocityY: 900 }),
      true,
    );
  });

  test("keeps it on a drag up, which points into the screen", () => {
    assert.equal(
      toastSwipeDismisses({ ...still, ...pill, translationY: -40, velocityY: -900 }),
      false,
    );
  });

  test("keeps it when the finger flicks back against the drag", () => {
    assert.equal(
      toastSwipeDismisses({ ...still, ...pill, translationY: 30, velocityY: -900 }),
      false,
    );
    assert.equal(
      toastSwipeDismisses({ ...still, ...pill, translationX: 100, velocityX: -900 }),
      false,
    );
  });
});
