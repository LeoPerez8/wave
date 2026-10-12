/// <reference types="node" />
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { pressedRect, runPressedAt } from "./pressedRect.ts";

const row = { left: 0, top: 200, right: 412, bottom: 256 };

describe("runPressedAt", () => {
  test("a handler that opens a menu sees the pressed rect, and says so", () => {
    let seen;
    const opened = runPressedAt(row, () => {
      seen = pressedRect();
    });
    assert.deepEqual(seen, row);
    assert.equal(opened, true);
    assert.equal(pressedRect(), undefined);
  });

  test("a handler that doesn't open a menu (a tab's long-press) says it didn't", () => {
    assert.equal(
      runPressedAt(row, () => {}),
      false,
    );
  });
});
