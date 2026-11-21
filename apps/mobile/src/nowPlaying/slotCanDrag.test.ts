import assert from "node:assert/strict";
import { test } from "node:test";

import { slotCanDrag } from "./slotCanDrag.ts";

test("only a slot holding a button can start a drag", () => {
  assert.equal(slotCanDrag(null), false);
  assert.equal(slotCanDrag("lyrics"), true);
});
