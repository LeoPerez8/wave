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
  artworkPalette,
} from "./libraryQueries.ts";
import { creditSplits } from "./credits.ts";
import { addTrack, closeTestDatabase, openTestDatabase, traceQueries } from "./testDatabase.ts";

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

test("a cover's colours are found by its artwork path", async () => {
  const db = await openTestDatabase();
  try {
    addTrack(db, { title: "One", album: "Album", artworkHash: "cover" });
    assert.deepEqual(artworkPalette(db, "/covers/cover.jpg"), {});
    assert.equal(artworkPalette(db, "/covers/unknown.jpg"), null);
    assert.equal(artworkPalette(db, "/elsewhere/cover.jpg"), null);
    assert.equal(artworkPalette(db, "https://lh3.googleusercontent.com/cover"), null);
    assert.equal(artworkPalette(db, "/covers/cover"), null);
  } finally {
    closeTestDatabase(db);
  }
});

test("a cover's colours are read by the artwork table's key, not a scan", async () => {
  const db = await openTestDatabase();
  try {
    addTrack(db, { title: "One", album: "Album", artworkHash: "cover" });
    const { result, queries } = traceQueries(db, () => artworkPalette(db, "/covers/cover.jpg"));
    assert.deepEqual(result, {});
    assert.deepEqual(
      queries.flatMap((query) => query.plan).filter((step) => /^SCAN artwork\b/u.test(step)),
      [],
    );
  } finally {
    closeTestDatabase(db);
  }
});
