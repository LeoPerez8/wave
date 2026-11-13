/// <reference types="node" />
import assert from "node:assert/strict";
import { beforeEach, describe, test } from "node:test";

import { normalizeTrack } from "@wave/core";
import { desc } from "drizzle-orm";

import type { IndexedTrack } from "../LibraryStore.ts";
import { creditSplits } from "./credits.ts";
import {
  keepLyricsSearchText,
  selectLyricsCandidates,
  selectLyricsIndexPage,
  selectLyricsSearchText,
} from "./lyricsSearchIndex.ts";
import { saveBatch } from "./save.ts";
import { deleteTracksById } from "./tracks.ts";
import * as schema from "./schema.ts";
import { openTestDatabase, type TestDatabase } from "./testDatabase.ts";

let db: TestDatabase;

beforeEach(async () => {
  db = await openTestDatabase();
});

const file = (title: string): IndexedTrack => ({
  ...normalizeTrack({
    path: `/Music/${title}.mp3`,
    title,
    artist: "Artist",
    album: "Album",
    durationMs: 200_000,
  }),
  sizeBytes: 1_000,
  modifiedAt: 1,
  sampleRate: null,
  bitrateKbps: null,
  artworkHash: null,
  hasLyrics: true,
  explicit: "unknown",
  videoId: null,
});

const saveTrack = (title: string): number => {
  saveBatch(db, creditSplits(), [file(title)], [], [], 1_000);
  return db
    .select({ id: schema.tracks.id })
    .from(schema.tracks)
    .orderBy(desc(schema.tracks.id))
    .get()!.id;
};

describe("local lyrics search index", () => {
  test("the token index narrows phrase candidates with punctuation and diacritics folded", () => {
    const id = saveTrack("Trem bala");
    keepLyricsSearchText(db, id, "Trem-Balá!\nOther line");

    assert.deepEqual(selectLyricsCandidates(db, "trem bala"), [
      { trackId: id, lyrics: "Trem-Balá!\nOther line" },
    ]);
    assert.deepEqual(selectLyricsCandidates(db, "bala trem"), []);
  });

  test("background pages include only songs with lyrics that have no index row", () => {
    const first = saveTrack("First");
    const second = saveTrack("Second");
    keepLyricsSearchText(db, first, "first line");

    assert.deepEqual(selectLyricsIndexPage(db, 0, 20), [
      { id: second, path: "/Music/Second.mp3", hasLyrics: true },
    ]);
  });

  test("refresh replaces text, empty text removes it, and deleting a track cascades", () => {
    const id = saveTrack("First");
    keepLyricsSearchText(db, id, "old phrase");
    keepLyricsSearchText(db, id, "new phrase");
    assert.equal(selectLyricsSearchText(db, id), "new phrase");
    assert.deepEqual(selectLyricsCandidates(db, "old phrase"), []);
    keepLyricsSearchText(db, id, "");
    assert.equal(selectLyricsSearchText(db, id), null);
    assert.deepEqual(selectLyricsCandidates(db, "new phrase"), []);

    keepLyricsSearchText(db, id, "new phrase");
    deleteTracksById(db, [id]);
    assert.equal(selectLyricsSearchText(db, id), null);
    assert.deepEqual(selectLyricsCandidates(db, "new phrase"), []);
  });
});
