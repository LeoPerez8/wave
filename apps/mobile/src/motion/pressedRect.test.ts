/// <reference types="node" />
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { pressedElement, pressedRect, runPressedAt } from "./pressedRect.ts";

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

  test("a handler that opens a card sees which Press it runs for, and says so", () => {
    let seen;
    const opened = runPressedAt(
      row,
      () => {
        seen = pressedElement();
      },
      7,
    );
    assert.deepEqual(seen, { key: 7, rect: row, onChrome: false });
    assert.equal(opened, true);
    assert.equal(pressedElement(), undefined);
  });

  test("a handler run for a Press on the floating chrome says so", () => {
    let seen;
    runPressedAt(
      row,
      () => {
        seen = pressedElement();
      },
      3,
      true,
    );
    assert.deepEqual(seen, { key: 3, rect: row, onChrome: true });
  });

  test("a handler that doesn't open a menu (a tab's long-press) says it didn't", () => {
    assert.equal(
      runPressedAt(row, () => {}),
      false,
    );
  });
});
