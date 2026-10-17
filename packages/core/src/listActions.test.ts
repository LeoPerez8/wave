import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { lastListActionForm } from "./index.ts";

// Widths in dp as a line measures them: Play 72, Shuffle 96 (Smart Shuffle 156),
// 32 between actions, Download 120 and Retry Failed 136 with their labels.
const room = {
  line: 470,
  gap: 32,
  before: [72, 96],
  last: { Download: 120, "Retry Failed": 136, Cancel: 94 },
};

describe("lastListActionForm", () => {
  test("with room beside Play and Shuffle, the action keeps its label", () => {
    // 72 + 32 + 96 + 32 + 120 = 352
    assert.equal(lastListActionForm({ ...room, line: 352 }, "Download"), "labelled");
  });

  test("a dp short of that, it shows its icon alone instead of wrapping", () => {
    assert.equal(lastListActionForm({ ...room, line: 351 }, "Download"), "icon");
  });

  test("each label is checked on its own, so a longer one can drop to the icon", () => {
    const line = { ...room, line: 360 };
    assert.equal(lastListActionForm(line, "Download"), "labelled");
    assert.equal(lastListActionForm(line, "Retry Failed"), "icon");
    assert.equal(lastListActionForm(line, "Cancel"), "labelled");
  });

  test("Smart Shuffle's longer label leaves less room", () => {
    const line = { ...room, line: 360 };
    assert.equal(lastListActionForm({ ...line, before: [72, 156] }, "Download"), "icon");
  });

  test("large system text widens every action, and the label goes", () => {
    // The same line at 1.3x text: 94 + 32 + 125 + 32 + 156 = 439.
    const large = { line: 400, gap: 32, before: [94, 125], last: { Download: 156 } };
    assert.equal(lastListActionForm(large, "Download"), "icon");
  });

  test("until the line and every action are measured, neither form is guessed", () => {
    assert.equal(lastListActionForm({ ...room, line: undefined }, "Download"), null);
    assert.equal(lastListActionForm({ ...room, before: [72, undefined] }, "Download"), null);
    assert.equal(lastListActionForm({ ...room, last: {} }, "Download"), null);
  });

  test("layout's rounding of a width that fits doesn't drop the label", () => {
    assert.equal(lastListActionForm({ ...room, line: 351.7 }, "Download"), "labelled");
  });
});
