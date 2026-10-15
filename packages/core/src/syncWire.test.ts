import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { EMPTY_SYNC_TABLES, SYNC_PUSH_BATCH, pushBatches, readPullPage } from "./index.ts";
import type { SyncPlayRow, SyncTables } from "./index.ts";

const KEY = "abbey road\u001fthe beatles\u001fsomething\u001f1.2";

const play = (n: number): SyncPlayRow => ({
  id: `blackplayer:${n}:${KEY}`,
  songId: KEY,
  startedAt: 1_600_000_000_000 + n * 60_000,
  listenedMs: 182_000,
  durationMs: 182_000,
  endReason: "completed",
  counted: true,
  contextType: null,
  contextId: null,
  source: "phone",
  importedFrom: "blackplayer",
});

const utf8Bytes = (text: string): number => new TextEncoder().encode(text).length;

describe("readPullPage", () => {
  test("reads every table's rows, tombstones too, with the cursor and whether more wait", () => {
    const song = {
      id: KEY,
      changedAt: 10,
      phoneId: "b",
      deleted: false,
      title: "Something",
      credit: "The Beatles",
      album: "Abbey Road",
      albumArtist: "The Beatles",
      discNumber: 1,
      trackNumber: 2,
      durationMs: 182_000,
      year: 1969,
      genre: "Rock",
      videoId: null,
      addedAt: 3,
    };
    const body = {
      songs: [song],
      playlists: [{ id: "p1", changedAt: 11, phoneId: "b", deleted: true }],
      playlistEntries: [
        {
          id: "e1",
          changedAt: 12,
          phoneId: "b",
          deleted: false,
          playlistId: "p1",
          orderKey: "a0",
          songId: KEY,
          ytSong: null,
          addedAt: 12,
        },
      ],
      favorites: [{ id: KEY, changedAt: 13, phoneId: "b", deleted: false, addedAt: 13 }],
      preferences: [
        { id: "settings.theme", changedAt: 14, phoneId: "b", deleted: false, value: '{"a":"b"}' },
      ],
      plays: [play(1)],
      cursor: "42",
      more: true,
    };

    assert.deepEqual(readPullPage(JSON.stringify(body)), body);
  });

  test("leaves out a row it can't read, and tables it doesn't know, but keeps the page", () => {
    const body = {
      favorites: [
        { id: KEY, changedAt: "soon", phoneId: "b", deleted: false, addedAt: 13 },
        { id: "other", changedAt: 13, phoneId: "b", deleted: false, addedAt: 13 },
      ],
      plays: [{ ...play(1), endReason: "exploded" }],
      lyrics: [{ id: "x" }],
      cursor: "7",
      more: false,
    };

    assert.deepEqual(readPullPage(JSON.stringify(body)), {
      ...EMPTY_SYNC_TABLES,
      favorites: [{ id: "other", changedAt: 13, phoneId: "b", deleted: false, addedAt: 13 }],
      cursor: "7",
      more: false,
    });
  });

  test("an answer that isn't a page is nothing", () => {
    assert.equal(readPullPage("<html>"), null);
    assert.equal(readPullPage(JSON.stringify({ songs: [] })), null);
    assert.equal(readPullPage(JSON.stringify([])), null);
  });
});

describe("pushBatches", () => {
  test("18,000 BlackPlayer plays go up in batches under the body limit, each play once, in order", () => {
    const plays = Array.from({ length: 18_000 }, (_, n) => play(n));
    const batches = pushBatches({ ...EMPTY_SYNC_TABLES, plays });

    assert.ok(batches.length > 1);
    for (const batch of batches) {
      assert.ok(utf8Bytes(JSON.stringify(batch)) <= SYNC_PUSH_BATCH.maxBytes);
      assert.ok(batch.plays.length <= SYNC_PUSH_BATCH.maxRows);
    }
    assert.deepEqual(
      batches.flatMap((batch) => batch.plays),
      plays,
    );
  });

  test("a few changes go up in one push, and nothing to push is no push", () => {
    const changes: SyncTables = {
      ...EMPTY_SYNC_TABLES,
      favorites: [{ id: KEY, changedAt: 5, phoneId: "a", deleted: false, addedAt: 5 }],
      preferences: [
        { id: "settings.glass", changedAt: 6, phoneId: "a", deleted: false, value: "{}" },
      ],
    };
    assert.deepEqual(pushBatches(changes), [changes]);
    assert.deepEqual(pushBatches(EMPTY_SYNC_TABLES), []);
  });

  test("the limit counts bytes, not characters", () => {
    const title = "夜に駆ける".repeat(200);
    const songs = Array.from({ length: 900 }, (_, n) => ({
      id: `${title}\u001f${n}`,
      changedAt: n,
      phoneId: "a",
      deleted: false as const,
      title,
      credit: "YOASOBI",
      album: null,
      albumArtist: "YOASOBI",
      discNumber: null,
      trackNumber: null,
      durationMs: 261_000,
      year: 2019,
      genre: null,
      videoId: null,
      addedAt: n,
    }));
    const batches = pushBatches({ ...EMPTY_SYNC_TABLES, songs });

    assert.ok(batches.length > 1);
    for (const batch of batches) {
      assert.ok(utf8Bytes(JSON.stringify(batch)) <= SYNC_PUSH_BATCH.maxBytes);
    }
    assert.equal(
      batches.reduce((sum, batch) => sum + batch.songs.length, 0),
      songs.length,
    );
  });

  test("songs and playlists go up before the entries, favorites and plays that point at them", () => {
    const plays = Array.from({ length: 1_500 }, (_, n) => play(n));
    const playlists = [
      {
        id: "p1",
        changedAt: 1,
        phoneId: "a",
        deleted: false as const,
        name: "Drive",
        createdAt: 1,
      },
    ];
    const batches = pushBatches({ ...EMPTY_SYNC_TABLES, plays, playlists });

    assert.deepEqual(batches[0]?.playlists, playlists);
    assert.equal(batches.length, 2);
  });
});
