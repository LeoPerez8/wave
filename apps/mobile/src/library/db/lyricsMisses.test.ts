/// <reference types="node" />
import assert from "node:assert/strict";
import { beforeEach, describe, test } from "node:test";

import { normalizeTrack } from "@wave/core";

import type { IndexedTrack } from "../LibraryStore.ts";
import { creditSplits } from "./credits.ts";
import { keepLyricsMiss, selectLyricsSearchTrack } from "./lyricsMisses.ts";
import { saveBatch } from "./save.ts";
import { deleteTracksById } from "./tracks.ts";
import * as schema from "./schema.ts";
import { openTestDatabase, type TestDatabase } from "./testDatabase.ts";

let db: TestDatabase;

beforeEach(async () => {
  db = await openTestDatabase();
});

const file = (videoId: string | null = null): IndexedTrack => ({
  ...normalizeTrack({
    path: "/Music/Daft Punk/Instant Crush.m4a",
    title: "Instant Crush",
    artist: "Daft Punk, Julian Casablancas",
    album: "Random Access Memories",
    durationMs: 337_000,
  }),
  sizeBytes: 1_000,
  modifiedAt: 0,
  sampleRate: null,
  bitrateKbps: null,
  artworkHash: null,
  hasLyrics: false,
  explicit: "unknown",
  videoId,
});

const saveTrack = (track: IndexedTrack): number => {
  saveBatch(db, creditSplits(), [track], [], [], 1_000);
  const row = db.select({ id: schema.tracks.id }).from(schema.tracks).get();
  if (row === undefined) throw new Error("not saved");
  return row.id;
};

describe("a Library song's lyrics search", () => {
  test("reads what the search goes by, with no miss remembered at first", () => {
    const id = saveTrack(file("crush"));
    assert.deepEqual(selectLyricsSearchTrack(db, id), {
      title: "Instant Crush",
      artist: "Daft Punk, Julian Casablancas",
      album: "Random Access Memories",
      durationMs: 337_000,
      videoId: "crush",
      missedAt: null,
    });
    assert.equal(selectLyricsSearchTrack(db, id + 1), null);
  });

  test("a miss is remembered for the track, a rescan keeps it, and it can be forgotten", () => {
    const id = saveTrack(file());
    keepLyricsMiss(db, id, 5_000);
    assert.equal(selectLyricsSearchTrack(db, id)?.missedAt, 5_000);
    keepLyricsMiss(db, id, 9_000);
    saveBatch(db, creditSplits(), [{ ...file(), modifiedAt: 1 }], [], [], 2_000);
    assert.equal(selectLyricsSearchTrack(db, id)?.missedAt, 9_000);
    keepLyricsMiss(db, id, null);
    assert.equal(selectLyricsSearchTrack(db, id)?.missedAt, null);
  });

  test("deleting the song drops its miss", () => {
    const id = saveTrack(file());
    keepLyricsMiss(db, id, 5_000);
    deleteTracksById(db, [id]);
    assert.equal(db.select().from(schema.lyricsMisses).all().length, 0);
  });
});
