/// <reference types="node" />
import assert from "node:assert/strict";
import { beforeEach, describe, test } from "node:test";

import { normalizeTrack } from "@wave/core";
import { desc, eq } from "drizzle-orm";

import type { IndexedTrack } from "../LibraryStore.ts";
import { creditSplits } from "./credits.ts";
import {
  keepLyricsSearchText,
  selectLyricsCandidates,
  selectLyricsIndexPage,
  selectLyricsSearchText,
  selectStaleLyricsIndexPage,
} from "./lyricsSearchIndex.ts";
import { saveBatch } from "./save.ts";
import { deleteTracksById } from "./tracks.ts";
import * as schema from "./schema.ts";
import { openTestDatabase, reopenTestDatabase, type TestDatabase } from "./testDatabase.ts";

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

  test("a phrase repeated in a chorus finds its song once", () => {
    const id = saveTrack("Chorus");
    const lyrics = "I love you\nyes I love you\nI love you";
    keepLyricsSearchText(db, id, lyrics);

    assert.deepEqual(selectLyricsCandidates(db, "i love"), [{ trackId: id, lyrics }]);
  });

  test("a common word hands Search at most 100 songs", () => {
    saveBatch(
      db,
      creditSplits(),
      Array.from({ length: 101 }, (_, n) => file(`Song ${n}`)),
      [],
      [],
      1_000,
    );
    for (const { id } of db.select({ id: schema.tracks.id }).from(schema.tracks).all())
      keepLyricsSearchText(db, id, "love\nlove");

    assert.equal(selectLyricsCandidates(db, "love").length, 100);
  });

  test("background pages include only songs with lyrics that have no index row", () => {
    const first = saveTrack("First");
    const second = saveTrack("Second");
    keepLyricsSearchText(db, first, "first line");

    assert.deepEqual(selectLyricsIndexPage(db, 0, 20), [
      { id: second, path: "/Music/Second.mp3", hasLyrics: true },
    ]);
  });

  test("a song whose lyrics read as empty is checked once and leaves the background pages", () => {
    const id = saveTrack("Blank");
    keepLyricsSearchText(db, id, "  ");

    assert.deepEqual(selectLyricsIndexPage(db, 0, 20), []);
    assert.deepEqual(selectLyricsCandidates(db, "blank"), []);
    keepLyricsSearchText(db, id, "now it has words");
    assert.equal(selectLyricsCandidates(db, "has words")[0]?.trackId, id);
  });

  test("refresh replaces text, no text removes it, and deleting a track cascades", () => {
    const id = saveTrack("First");
    keepLyricsSearchText(db, id, "old phrase");
    keepLyricsSearchText(db, id, "new phrase");
    assert.equal(selectLyricsSearchText(db, id), "new phrase");
    assert.deepEqual(selectLyricsCandidates(db, "old phrase"), []);
    keepLyricsSearchText(db, id, null);
    assert.equal(selectLyricsSearchText(db, id), null);
    assert.deepEqual(selectLyricsCandidates(db, "new phrase"), []);

    keepLyricsSearchText(db, id, "new phrase");
    deleteTracksById(db, [id]);
    assert.equal(selectLyricsSearchText(db, id), null);
    assert.deepEqual(selectLyricsCandidates(db, "new phrase"), []);
  });

  test("lyrics stay indexed across a database reopen", async () => {
    const id = saveTrack("Persistent");
    keepLyricsSearchText(db, id, "keep this phrase");
    db = await reopenTestDatabase(db);

    assert.equal(selectLyricsSearchText(db, id), "keep this phrase");
    assert.equal(selectLyricsCandidates(db, "keep this phrase")[0]?.trackId, id);
  });

  test("a Library song that lost its file is found by the stale-index sweep", () => {
    const id = saveTrack("Missing file");
    keepLyricsSearchText(db, id, "old local lyric");
    db.update(schema.tracks).set({ path: null }).where(eq(schema.tracks.id, id)).run();

    assert.deepEqual(selectStaleLyricsIndexPage(db, 0, 20), [{ id, path: null, hasLyrics: true }]);
  });
});
