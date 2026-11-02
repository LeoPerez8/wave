import { test } from "node:test";
import assert from "node:assert/strict";
import { addTrack, openTestDatabase } from "./testDatabase.ts";
import { trackQuery } from "./tracks.ts";
import { saveReleaseDate } from "./releaseDates.ts";
test("persists first-release dates but never replaces an original or typed date", async () => {
  const db = await openTestDatabase();
  const id = addTrack(db, { title: "Song" });
  saveReleaseDate(db, id, "1985");
  assert.equal(trackQuery(db).all()[0]?.releaseDate, "1985");
  saveReleaseDate(db, id, "2005");
  assert.equal(trackQuery(db).all()[0]?.releaseDate, "1985");
});
