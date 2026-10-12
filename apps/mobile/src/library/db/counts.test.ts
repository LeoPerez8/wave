/// <reference types="node" />
import assert from "node:assert/strict";
import { beforeEach, describe, test } from "node:test";

import { eq } from "drizzle-orm";

import { libraryCounts } from "./counts.ts";
import * as schema from "./schema.ts";
import { addTrack, openTestDatabase, star, type TestDatabase } from "./testDatabase.ts";

let db: TestDatabase;

beforeEach(async () => {
  db = await openTestDatabase();
});

describe("libraryCounts", () => {
  test("an empty library counts zero everywhere", () => {
    assert.deepEqual(libraryCounts(db), {
      playlists: 0,
      artists: 0,
      albums: 0,
      songs: 0,
      genres: 0,
      folders: 0,
      favorites: 0,
    });
  });

  test("counts what each Library list shows", () => {
    const airbag = addTrack(db, { title: "Airbag", album: "OK Computer", artist: "Radiohead" });
    addTrack(db, { title: "Karma Police", album: "OK Computer", artist: "Radiohead" });
    const joga = addTrack(db, { title: "Jóga", album: "Homogenic", artist: "Björk" });
    // A compilation: its album artist is listed under Artists too.
    addTrack(db, { title: "Hey", album: "Compilation", artist: "Pixies", albumArtist: "Various" });
    // An artist left without songs (pruned by the next scan) isn't counted.
    db.insert(schema.artists).values({ key: "Gone", name: "Gone", sort: "gone" }).run();

    const rock = db
      .insert(schema.genres)
      .values({ key: "rock", name: "Rock", sort: "rock" })
      .returning()
      .get().id;
    db.update(schema.tracks).set({ genreId: rock }).where(eq(schema.tracks.id, airbag)).run();
    db.update(schema.tracks).set({ genreId: rock }).where(eq(schema.tracks.id, joga)).run();
    // A genre without songs isn't listed.
    db.insert(schema.genres).values({ key: "jazz", name: "Jazz", sort: "jazz" }).run();

    star(db, airbag, 1);
    star(db, joga, 2);

    db.insert(schema.playlists).values({ name: "Drive", createdAt: 0, updatedAt: 0 }).run();
    db.insert(schema.playlists).values({ name: "Empty", createdAt: 0, updatedAt: 0 }).run();

    assert.deepEqual(libraryCounts(db), {
      playlists: 2,
      artists: 4,
      albums: 3,
      songs: 4,
      genres: 1,
      folders: 1,
      favorites: 2,
    });
  });
});
