import assert from "node:assert/strict";
import { test } from "node:test";
import { liftedTop } from "./liftedRow.ts";

const ROW = 64;

test("a playlist's lifted row follows the finger over the head and past the list's edges", () => {
  assert.equal(liftedTop(-150, 800, null, ROW), -150);
  assert.equal(liftedTop(900, 800, null, ROW), 900);
});

test("the Queue's lifted row stays inside the list, below Up Next's first slot", () => {
  assert.equal(liftedTop(-150, 800, 40, ROW), 40);
  assert.equal(liftedTop(300, 800, 40, ROW), 300);
  assert.equal(liftedTop(900, 800, 40, ROW), 800 - ROW);
});
