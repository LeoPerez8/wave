/// <reference types="node" />
import assert from "node:assert/strict";
import { beforeEach, describe, test } from "node:test";

import { selectGenreSongs } from "./genres.ts";
import * as schema from "./schema.ts";
import { addTrack, openTestDatabase, type TestDatabase } from "./testDatabase.ts";

let db: TestDatabase;

const genreId = (name: string): number => {
  const genre = db
    .select()
    .from(schema.genres)
    .all()
    .find((row) => row.name === name);
  if (genre === undefined) throw new Error(`no genre ${name}`);
  return genre.id;
};

beforeEach(async () => {
  db = await openTestDatabase();
  addTrack(db, { title: "Teardrop", artist: "Massive Attack", genre: "Trip-Hop" });
  addTrack(db, { title: "Airbag", artist: "Radiohead", genre: "Rock" });
  addTrack(db, { title: "Glory Box", artist: "Portishead", genre: "Trip-Hop" });
  addTrack(db, { title: "Angel", artist: "Massive Attack", genre: "Trip-Hop" });
  addTrack(db, { title: "Untagged", artist: "Nobody" });
});

describe("selectGenreSongs", () => {
  test("lists a genre's songs by title, as the genre screen does", () => {
    assert.deepEqual(
      selectGenreSongs(db, genreId("Trip-Hop")).map((song) => song.title),
      ["Angel", "Glory Box", "Teardrop"],
    );
  });

  test("an unknown genre has no songs", () => {
    assert.deepEqual(selectGenreSongs(db, 9_999), []);
  });
});
