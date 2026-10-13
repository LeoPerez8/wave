/// <reference types="node" />
import assert from "node:assert/strict";
import { beforeEach, describe, test } from "node:test";

import { eq } from "drizzle-orm";

import {
  removePlaylistItems,
  replacePlaylistSongs,
  selectPlaylistSongs,
  selectTrackPaths,
} from "./playlists.ts";
import * as schema from "./schema.ts";
import { addTrack, openTestDatabase, type TestDatabase } from "./testDatabase.ts";

let db: TestDatabase;
let playlistId: number;
const ids: Record<string, number> = {};

beforeEach(async () => {
  db = await openTestDatabase();
  for (const title of ["Airbag", "Bloom", "Creep", "Daydreaming"]) {
    ids[title] = addTrack(db, { title, album: "Mix", artist: "Radiohead" });
  }
  playlistId = db
    .insert(schema.playlists)
    .values({ name: "Drive", createdAt: 0, updatedAt: 0 })
    .returning()
    .get().id;
  // Out of title order, with a gap in the positions.
  const items: [string, number][] = [
    ["Daydreaming", 0],
    ["Airbag", 1],
    ["Creep", 5],
    ["Airbag", 7],
  ];
  for (const [title, position] of items) {
    db.insert(schema.playlistItems)
      .values({ playlistId, trackId: ids[title] ?? -1, position, addedAt: 0 })
      .run();
  }
});

const titles = (page?: { offset: number; limit: number }) =>
  selectPlaylistSongs(db, playlistId, page).map((song) => song.title);

describe("selectPlaylistSongs", () => {
  test("lists a playlist's songs in playlist order, repeats included", () => {
    assert.deepEqual(titles(), ["Daydreaming", "Airbag", "Creep", "Airbag"]);
  });

  test("each row carries its playlist item", () => {
    const items = selectPlaylistSongs(db, playlistId).map((song) => song.itemId);
    assert.equal(new Set(items).size, 4);
  });

  test("a page is a window of that order", () => {
    assert.deepEqual(titles({ offset: 1, limit: 2 }), ["Airbag", "Creep"]);
    assert.deepEqual(titles({ offset: 4, limit: 2 }), []);
  });

  test("songs that left the library drop out", () => {
    db.delete(schema.tracks)
      .where(eq(schema.tracks.id, ids.Creep ?? -1))
      .run();
    assert.deepEqual(titles(), ["Daydreaming", "Airbag", "Airbag"]);
  });
});

describe("removePlaylistItems", () => {
  const items = () => selectPlaylistSongs(db, playlistId);

  test("removes exactly the given entries; a repeat of the song left unchecked stays", () => {
    const [daydreaming, firstAirbag, creep] = items();
    removePlaylistItems(db, playlistId, [firstAirbag?.itemId ?? -1, creep?.itemId ?? -1], 1000);
    assert.deepEqual(titles(), ["Daydreaming", "Airbag"]);
    assert.equal(items()[0]?.itemId, daydreaming?.itemId);
  });

  test("marks the playlist as edited", () => {
    removePlaylistItems(db, playlistId, [items()[0]?.itemId ?? -1], 1000);
    const playlist = db
      .select()
      .from(schema.playlists)
      .where(eq(schema.playlists.id, playlistId))
      .get();
    assert.equal(playlist?.updatedAt, 1000);
  });

  test("leaves other playlists' entries alone", () => {
    const otherId = db
      .insert(schema.playlists)
      .values({ name: "Other", createdAt: 0, updatedAt: 0 })
      .returning()
      .get().id;
    removePlaylistItems(
      db,
      otherId,
      items().map((song) => song.itemId),
      1000,
    );
    assert.equal(items().length, 4);
  });
});

describe("replacePlaylistSongs", () => {
  test("the playlist then holds exactly the given songs, in that order", () => {
    replacePlaylistSongs(db, playlistId, [ids.Creep ?? -1, ids.Bloom ?? -1], 1000);
    assert.deepEqual(titles(), ["Creep", "Bloom"]);
  });

  test("marks the playlist as edited and keeps it (and its name)", () => {
    replacePlaylistSongs(db, playlistId, [ids.Bloom ?? -1], 1000);
    const playlist = db
      .select()
      .from(schema.playlists)
      .where(eq(schema.playlists.id, playlistId))
      .get();
    assert.equal(playlist?.name, "Drive");
    assert.equal(playlist?.updatedAt, 1000);
  });
});

describe("selectTrackPaths", () => {
  test("lists every track's file with its id, for matching playlist files by path", () => {
    assert.deepEqual(
      selectTrackPaths(db).toSorted((a, b) => a.id - b.id),
      ["Airbag", "Bloom", "Creep", "Daydreaming"].map((title) => ({
        id: ids[title],
        path: `/Music/Mix/${title}.mp3`,
      })),
    );
  });
});
