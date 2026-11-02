import { test } from "node:test";
import assert from "node:assert/strict";
import { addMissingSong, addTrack, openTestDatabase } from "./testDatabase.ts";
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
test("a date saved says which file can take it, once", async () => {
  const db = await openTestDatabase();
  const id = addTrack(db, { title: "Song", album: "Album" });
  assert.deepEqual(saveReleaseDate(db, id, "1985-06-21"), { path: "/Music/Album/Song.mp3" });
  assert.equal(saveReleaseDate(db, id, "1985-06-21"), null);
  // A missing song has no file: the date stays in the index.
  const missing = addMissingSong(db, { title: "Elsewhere" });
  assert.deepEqual(saveReleaseDate(db, missing, "1990"), { path: null });
});
