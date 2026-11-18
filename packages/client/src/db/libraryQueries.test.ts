import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ensureDefaultRoot,
  listRoots,
  addRoot,
  removeRootSync,
  rememberSearchSync,
  listRecentSearchesSync,
  countTracks,
} from "./libraryQueries.ts";
import { creditSplits } from "./credits.ts";
import { addTrack, closeTestDatabase, openTestDatabase } from "./testDatabase.ts";

test("scan roots keep songs under remaining roots and searches keep their recent order", async () => {
  const db = await openTestDatabase();
  try {
    ensureDefaultRoot(db, "/Music");
    addTrack(db, { title: "One", album: "Album" });
    assert.deepEqual(
      listRoots(db).map((root) => root.path),
      ["/Music"],
    );
    addRoot(db, "/Music/Album", []);
    removeRootSync(db, creditSplits(), "/Music");
    assert.deepEqual(
      listRoots(db).map((root) => root.path),
      ["/Music/Album"],
    );
    assert.equal(countTracks(db), 1);
    assert.throws(
      () => removeRootSync(db, creditSplits(), "/Music/Album"),
      /at least one music folder/,
    );
    rememberSearchSync(db, "Radiohead", 10);
    rememberSearchSync(db, "Björk", 20);
    assert.deepEqual(listRecentSearchesSync(db), ["Björk", "Radiohead"]);
  } finally {
    closeTestDatabase(db);
  }
});
