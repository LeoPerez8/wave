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
    assert.equal(toastDuration("New queue playing", { withAction: true }), 6_000);
    assert.equal(toastDuration("x".repeat(80), { withAction: true }), 8_000);
    assert.equal(toastDuration("x".repeat(400), { withAction: true }), 8_000);
  });
});

describe("toastSwipeDismisses", () => {
  const still = { translationY: 0, velocityY: 0 };
  // Two lines tall, so a short flick is shorter than a third of it.
  const pill = { height: 72 };

  test("sends the toast away on a drag up a third of its height, or a flick up", () => {
    assert.equal(toastSwipeDismisses({ ...still, ...pill, translationY: -24 }), true);
    assert.equal(toastSwipeDismisses({ ...still, ...pill, translationY: -18 }), false);
    assert.equal(
      toastSwipeDismisses({ ...still, ...pill, translationY: -18, velocityY: -900 }),
      true,
    );
  });

  test("keeps it on a drag down: it leaves only off the top", () => {
    assert.equal(
      toastSwipeDismisses({ ...still, ...pill, translationY: 40, velocityY: 900 }),
      false,
    );
  });

  test("keeps it when the finger flicks back down against the drag", () => {
    assert.equal(
      toastSwipeDismisses({ ...still, ...pill, translationY: -30, velocityY: 900 }),
      false,
    );
  });
});
