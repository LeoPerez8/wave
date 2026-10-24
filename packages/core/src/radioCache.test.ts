import assert from "node:assert/strict";
import { test } from "node:test";
import { radioCacheFresh } from "./index.ts";

test("a radio is fresh for less than seven days, using its read time alone", () => {
  const now = 10 * 86400000;
  assert.equal(radioCacheFresh(now - 7 * 86400000 + 1, now), true);
  assert.equal(radioCacheFresh(now - 7 * 86400000, now), false);
  assert.equal(radioCacheFresh(null, now), false);
  assert.equal(radioCacheFresh(NaN, now), false);
  assert.equal(radioCacheFresh(now + 1, now), false);
});
