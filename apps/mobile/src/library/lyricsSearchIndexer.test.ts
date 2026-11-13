/// <reference types="node" />
import assert from "node:assert/strict";
import { beforeEach, describe, test } from "node:test";

import { normalizeTrack, type Lyrics } from "@wave/core";
import { desc, eq } from "drizzle-orm";
import * as Effect from "effect/Effect";

import { creditSplits } from "./db/credits.ts";
import {
  keepLyricsSearchText,
  selectLyricsCandidates,
  selectLyricsIndexPage,
  selectLyricsIndexTarget,
  selectStaleLyricsIndexPage,
} from "./db/lyricsSearchIndex.ts";
import { indexSavedLyrics, selectSavedLyricsSearchIndexPage } from "./db/savedLyrics.ts";
import { saveBatch } from "./db/save.ts";
import * as schema from "./db/schema.ts";
import { openTestDatabase, type TestDatabase } from "./db/testDatabase.ts";
import type { IndexedTrack } from "./LibraryStore.ts";
import { createLyricsSearchIndexer, type LyricsIndexStore } from "./lyricsSearchIndexer.ts";

let db: TestDatabase;
let reads: string[];
let changes: number;
let lyricsOnDisk: Map<string, Lyrics>;

const store = (): LyricsIndexStore => ({
  lyricsIndexTarget: (id) => Effect.sync(() => selectLyricsIndexTarget(db, id)),
  lyricsIndexPage: (after, limit) => Effect.sync(() => selectLyricsIndexPage(db, after, limit)),
  staleLyricsIndexPage: (after, limit) =>
    Effect.sync(() => selectStaleLyricsIndexPage(db, after, limit)),
  keepLyricsSearchText: (id, lyrics) => Effect.sync(() => keepLyricsSearchText(db, id, lyrics)),
  savedLyricsSearchIndexPage: (after, limit) =>
    Effect.sync(() => selectSavedLyricsSearchIndexPage(db, after, limit)),
  indexSavedLyricsSearchText: (candidate) => Effect.sync(() => indexSavedLyrics(db, candidate)),
});

const indexer = () =>
  createLyricsSearchIndexer({
    withStore: (run) => Effect.runPromise(run(store())),
    readLyrics: async (path) => {
      reads.push(path);
      return lyricsOnDisk.get(path) ?? { kind: "none" };
    },
    changed: () => {
      changes++;
    },
    freeTurn: async () => {},
  });

const saveTrack = (title: string): number => {
  const track: IndexedTrack = {
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
  };
  saveBatch(db, creditSplits(), [track], [], [], 1_000);
  return db
    .select({ id: schema.tracks.id })
    .from(schema.tracks)
    .orderBy(desc(schema.tracks.id))
    .get()!.id;
};

beforeEach(async () => {
  db = await openTestDatabase();
  reads = [];
  changes = 0;
  lyricsOnDisk = new Map();
});

describe("lyrics Search indexer", () => {
  test("a file whose lyrics read as empty is read once, not on every Library change", async () => {
    saveTrack("Blank");
    const run = indexer();

    await run.fill();
    await run.tracksChanged();
    await run.tracksChanged();

    assert.deepEqual(reads, ["/Music/Blank.mp3"]);
  });

  test("a rescanned file is read again", async () => {
    const id = saveTrack("Blank");
    const run = indexer();
    await run.fill();
    lyricsOnDisk.set("/Music/Blank.mp3", { kind: "unsynced", lines: ["words at last"] });

    await run.tracksChanged([id]);

    assert.equal(selectLyricsCandidates(db, "at last")[0]?.trackId, id);
  });

  test("a song that lost its file leaves Search and tells it so", async () => {
    const id = saveTrack("Gone");
    lyricsOnDisk.set("/Music/Gone.mp3", { kind: "unsynced", lines: ["gone phrase"] });
    const run = indexer();
    await run.fill();
    db.update(schema.tracks).set({ path: null }).where(eq(schema.tracks.id, id)).run();
    changes = 0;

    await run.tracksChanged([id]);

    assert.deepEqual(selectLyricsCandidates(db, "gone phrase"), []);
    assert.equal(changes, 1);
  });
});
