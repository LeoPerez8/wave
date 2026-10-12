/// <reference types="node" />
import assert from "node:assert/strict";
import { beforeEach, describe, test } from "node:test";

import { eq } from "drizzle-orm";

import {
  clearArtistPhotos,
  recordArtistPhoto,
  selectArtistPhotoLookups,
  selectArtistPhotos,
} from "./artistPhotos.ts";
import * as schema from "./schema.ts";
import {
  addTrack,
  migrateTestDatabase,
  openTestDatabase,
  type TestDatabase,
} from "./testDatabase.ts";

const DAY = 24 * 60 * 60 * 1000;
const now = 100 * DAY;

let db: TestDatabase;

beforeEach(async () => {
  db = await openTestDatabase();
  addTrack(db, { title: "Airbag", album: "OK Computer", artist: "radiohead" });
  addTrack(db, { title: "Jóga", album: "Homogenic", artist: "björk" });
  addTrack(db, {
    title: "Hey",
    album: "Compilation",
    artist: "pixies",
    albumArtist: "various artists",
  });
  // Fixture artists are keyed by their name; names here differ in case, as tags do.
  db.update(schema.artists)
    .set({ name: "Radiohead" })
    .where(eq(schema.artists.key, "radiohead"))
    .run();
});

const due = () => selectArtistPhotoLookups(db, now).map((artist) => artist.key);

describe("artist photo lookups", () => {
  test("every artist is due at first, except 'Various Artists', with the name to search", () => {
    assert.deepEqual(due().toSorted(), ["björk", "pixies", "radiohead"]);
    assert.equal(
      selectArtistPhotoLookups(db, now).find((artist) => artist.key === "radiohead")?.query,
      "Radiohead",
    );
  });

  test("a saved photo is listed by artist key and never looked up again", () => {
    recordArtistPhoto(db, "radiohead", {
      outcome: "found",
      checkedAt: now - 365 * DAY,
      path: "/files/artwork/artists/r.jpg",
      thumbPath: "/files/artwork/artists/r_thumb.jpg",
    });
    assert.deepEqual(due().toSorted(), ["björk", "pixies"]);
    assert.deepEqual(selectArtistPhotos(db), [
      {
        key: "radiohead",
        path: "/files/artwork/artists/r.jpg",
        thumbPath: "/files/artwork/artists/r_thumb.jpg",
      },
    ]);
  });

  test("a miss waits for its retry, and a later lookup replaces it", () => {
    recordArtistPhoto(db, "björk", { outcome: "failed", checkedAt: now - 1000 });
    recordArtistPhoto(db, "pixies", { outcome: "unmatched", checkedAt: now - 2 * DAY });
    assert.deepEqual(due(), ["radiohead"]);
    assert.deepEqual(selectArtistPhotos(db), []);

    recordArtistPhoto(db, "björk", { outcome: "unmatched", checkedAt: now - 8 * DAY });
    assert.deepEqual(due().toSorted(), ["björk", "radiohead"]);
  });

  test("clearing forgets every photo and every miss", () => {
    recordArtistPhoto(db, "radiohead", {
      outcome: "found",
      checkedAt: now,
      path: "/r.jpg",
      thumbPath: "/r_thumb.jpg",
    });
    recordArtistPhoto(db, "björk", { outcome: "unmatched", checkedAt: now });
    clearArtistPhotos(db);
    assert.deepEqual(selectArtistPhotos(db), []);
    assert.deepEqual(due().toSorted(), ["björk", "pixies", "radiohead"]);
  });

  test("a library from before artist photos gets the table on update", async () => {
    const old = await openTestDatabase({ through: "0008_artist_images" });
    addTrack(old, { title: "Airbag", artist: "radiohead" });
    await migrateTestDatabase(old);
    assert.deepEqual(
      selectArtistPhotoLookups(old, now).map((artist) => artist.key),
      ["radiohead"],
    );
  });
});
