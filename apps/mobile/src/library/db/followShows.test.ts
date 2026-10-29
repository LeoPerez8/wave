import { test } from "node:test";
import assert from "node:assert/strict";
import { openTestDatabase, reopenTestDatabase, closeTestDatabase } from "./testDatabase.ts";
import { readFollowShows, saveFollowShows, markShowNotified } from "./followShows.ts";
test("shows keep attraction IDs and notification receipts after restart; country replaces the cache", async () => {
  const db = await openTestDatabase();
  saveFollowShows(db, {
    key: "aurora",
    attractionId: "music",
    country: "BR",
    shows: [],
    checkedAt: 123,
  });
  assert.equal(markShowNotified(db, "show-1"), true);
  assert.equal(markShowNotified(db, "show-1"), false);
  const next = await reopenTestDatabase(db);
  assert.deepEqual(readFollowShows(next).notified, ["show-1"]);
  assert.equal(readFollowShows(next).artists[0]?.attractionId, "music");
  saveFollowShows(next, {
    key: "aurora",
    attractionId: "music",
    country: "US",
    shows: [],
    checkedAt: 456,
  });
  assert.deepEqual(
    readFollowShows(next).artists.map((a) => a.country),
    ["US"],
  );
  closeTestDatabase(next);
});
