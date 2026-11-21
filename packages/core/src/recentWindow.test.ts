import assert from "node:assert/strict";
import { test } from "node:test";
import { isRecent, RECENT_WINDOW_DAYS, recentWindowStart } from "./index.ts";

const DAY = 86_400_000;
const now = 100 * DAY;

test("recently reaches 14 days back, edge included", () => {
  assert.equal(RECENT_WINDOW_DAYS, 14);
  assert.equal(recentWindowStart(now), now - 14 * DAY);
  assert.equal(isRecent(now - 14 * DAY, now), true);
  assert.equal(isRecent(now - 14 * DAY - 1, now), false);
  assert.equal(isRecent(now, now), true);
  assert.equal(isRecent(now + 1, now), false);
});
