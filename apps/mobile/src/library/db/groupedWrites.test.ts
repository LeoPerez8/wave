/// <reference types="node" />
import { EMPTY_SYNC_TABLES, normalizeTrack, type SyncPlayRow } from "@wave/core";
import assert from "node:assert/strict";
import { beforeEach, describe, test } from "node:test";

import type { IndexedTrack } from "../LibraryStore.ts";
import { saveImportedPlays } from "./blackPlayer.ts";
import { creditSplits } from "./credits.ts";
import { saveBatch } from "./save.ts";
import * as schema from "./schema.ts";
import { applyPulledPage } from "./syncRows.ts";
import {
  addTrack,
  openTestDatabase,
  traceTransactions,
  type TestDatabase,
} from "./testDatabase.ts";

let db: TestDatabase;

beforeEach(async () => {
  db = await openTestDatabase();
});

const file = (n: number): IndexedTrack => ({
  ...normalizeTrack({
    path: `/Music/Album ${n % 7}/Song ${n}.m4a`,
    title: `Song ${n}`,
    artist: `Artist ${n % 5}`,
    album: `Album ${n % 7}`,
    durationMs: 200_000,
  }),
  sizeBytes: 1_000,
  modifiedAt: 0,
  sampleRate: null,
  bitrateKbps: null,
  artworkHash: null,
  hasLyrics: false,
  explicit: "unknown",
  videoId: null,
});

/** The Library's tracks by recording key, as a pull turns the account's songs into them. */
const trackIds = (): Map<string, number> =>
  new Map(
    db
      .select({ key: schema.tracks.recordingKey, id: schema.tracks.id })
      .from(schema.tracks)
      .all()
      .flatMap((row) => (row.key === null ? [] : [[row.key, row.id] as const])),
  );

const pulledPlay = (id: string, songId: string, startedAt: number): SyncPlayRow => ({
  id,
  songId,
  startedAt,
  listenedMs: 200_000,
  durationMs: 200_000,
  endReason: "completed",
  counted: true,
  contextType: null,
  contextId: null,
  source: "phone",
  importedFrom: null,
});

describe("Grouped writes run in one transaction each", () => {
  test("a scan's save slice", () => {
    const slice = Array.from({ length: 100 }, (_, n) => file(n));

    const traced = traceTransactions(db, () =>
      saveBatch(db, creditSplits(), slice, [], [], 1_000, { linkEntries: false }),
    );

    assert.equal(traced.result.trackIds.length, 100);
    assert.equal(traced.transactions, 1);
    assert.deepEqual(traced.writesOutside, []);
  });

  test("imported plays", () => {
    const songs = Array.from({ length: 10 }, (_, n) => addTrack(db, { title: `Song ${n}` }));
    const plays = Array.from({ length: 500 }, (_, n) => ({
      trackId: songs[n % songs.length]!,
      startedAt: 1_000 + n,
    }));

    const traced = traceTransactions(db, () => saveImportedPlays(db, plays));

    assert.equal(traced.transactions, 1);
    assert.deepEqual(traced.writesOutside, []);
  });

  test("a pulled page", () => {
    for (let n = 0; n < 10; n++) addTrack(db, { title: `Song ${n}` });
    const keys = [...trackIds().keys()];
    const plays = Array.from({ length: 300 }, (_, n) =>
      pulledPlay(`play-${n}`, keys[n % keys.length]!, 1_000 + n),
    );

    const traced = traceTransactions(db, () =>
      applyPulledPage(db, { ...EMPTY_SYNC_TABLES, plays, cursor: "c", more: false }, trackIds(), 0),
    );

    assert.ok(traced.result.plays);
    assert.equal(traced.transactions, 1);
    assert.deepEqual(traced.writesOutside, []);
  });
});
