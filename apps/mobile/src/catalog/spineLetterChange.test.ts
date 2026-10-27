import assert from "node:assert/strict";
import { test } from "node:test";
import { spineLayout } from "@wave/core";
import { spineLetterChange } from "./spineLetterChange.ts";

test("scrubbing schedules JS only for a changed target letter, including sparse slots and edges", () => {
  const layout = spineLayout(
    [
      { letter: "A", index: 0 },
      { letter: "D", index: 40 },
    ],
    { space: 560, slotHeight: 20, labelHeight: 14 },
  );
  assert.deepEqual(spineLetterChange(layout, -100, null), { letter: "A", index: 0 });
  assert.equal(spineLetterChange(layout, 2, "A"), undefined);
  assert.deepEqual(spineLetterChange(layout, 21, "A"), { letter: "D", index: 40 });
  assert.equal(spineLetterChange(layout, 41, "D"), undefined);
  assert.equal(spineLetterChange(layout, 10000, "D"), undefined);
  assert.equal(spineLetterChange({ slots: [], height: 0, slotHeight: 0 }, 0, null), undefined);
  assert.deepEqual(spineLetterChange(layout, -100, "D"), { letter: "A", index: 0 });
});
