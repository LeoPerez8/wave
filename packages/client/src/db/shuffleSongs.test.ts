/// <reference types="node" />
import assert from "node:assert/strict";
import { beforeEach, describe, test } from "node:test";

import { shuffleSongs } from "./shuffleSongs.ts";
import { addTrack, openTestDatabase, type TestDatabase } from "./testDatabase.ts";

let db: TestDatabase;

beforeEach(async () => {
  db = await openTestDatabase();
});

describe("Even Shuffle's songs", () => {
  test("read each Library song's primary artist, genre and album by track id", () => {
    const tagged = addTrack(db, {
      title: "Dive",
      artist: "Sleep Token",
      album: "Take Me Back to Eden",
      genre: "Metal",
    });
    const bare = addTrack(db, { title: "Loose", artist: "Lana Del Rey", album: "Unknown Album" });
    assert.deepEqual(
      shuffleSongs(db, [String(tagged), String(bare), "yt:v-1", "999"]),
      new Map([
        [String(tagged), { artist: "Sleep Token", genre: "Metal", album: "Take Me Back to Eden" }],
        [String(bare), { artist: "Lana Del Rey", genre: null, album: null }],
      ]),
    );
  });

  test("know no artist for a song filed under Unknown Artist", () => {
    const id = addTrack(db, { title: "Untitled", artist: "Unknown Artist", album: "Tape" });
    assert.deepEqual(shuffleSongs(db, [String(id)]).get(String(id)), {
      artist: null,
      genre: null,
      album: "Tape",
    });
  });
});
