import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  EMPTY_SYNC_TABLES,
  SYNC_PUSH_BATCH,
  pushBatches,
  pushBody,
  readPullPage,
  readPushAnswer,
} from "./index.ts";
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
  contextPlaylistId: null,
  source: "phone",
  importedFrom: "blackplayer",
});

const utf8Bytes = (text: string): number => new TextEncoder().encode(text).length;

describe("readPullPage", () => {
  test("keeps desktop and existing play sources, excluding unknown sources", () => {
    const sources = ["phone", "auto", "desktop", "unknown"];
    const page = readPullPage(
      JSON.stringify({
        plays: sources.map((source, n) => ({ ...play(n), source })),
        cursor: "4",
        more: false,
      }),
    );

    assert.deepEqual(
      page?.plays.map((row) => row.source),
      ["phone", "auto", "desktop"],
    );
    assert.equal(page?.cursor, "4");
  });

  test("keeps legacy plays with absent or null metadata but leaves malformed new fields out", () => {
    const snapshot = {
      title: "Something",
      artist: "The Beatles",
      album: null,
      artworkPath: null,
      thumbPath: null,
    };
    const invalidSnapshots = [
      "not an object",
      [],
      {},
      { ...snapshot, title: 42 },
      { ...snapshot, artist: ["The Beatles"] },
      { ...snapshot, album: false },
      { ...snapshot, artworkPath: 42 },
      { ...snapshot, thumbPath: {} },
    ];
    const { contextPlaylistId: _, ...oldest } = play(1);
    const page = readPullPage(
      JSON.stringify({
        plays: [
          oldest,
          { ...play(2), snapshot: null, videoId: null },
          ...invalidSnapshots.map((invalidSnapshot, n) => ({
            ...play(n + 3),
            snapshot: invalidSnapshot,
          })),
          { ...play(20), videoId: 42 },
        ],
        cursor: "20",
        more: false,
      }),
    );

    assert.deepEqual(page?.plays, [
      { ...play(1), snapshot: null, videoId: null },
      { ...play(2), snapshot: null, videoId: null },
    ]);
  });

  test("keeps a play's display snapshot and a streamed play's video id", () => {
    const snapshot = {
      title: "Something",
      artist: "The Beatles, Billy Preston",
      album: "Abbey Road",
      artworkPath: "https://i.ytimg.com/vi/video-id/hqdefault.jpg",
      thumbPath: null,
    };
    const plays = [
      { ...play(1), importedFrom: null, snapshot, videoId: "video-id" },
      { ...play(2), snapshot: { ...snapshot, album: null, artworkPath: null }, videoId: null },
    ];
    const page = readPullPage(JSON.stringify({ plays, cursor: "2", more: false }));

    assert.deepEqual(page?.plays, plays);
  });

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
      releaseDate: null,
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
          removedAt: null,
          addedAt: 12,
          restoredAt: null,
          title: "Something",
          credit: "The Beatles",
          album: "Abbey Road",
          durationMs: 182_000,
          videoId: "vid-1",
          addedBy: "account-2",
        },
      ],
      favorites: [{ id: KEY, changedAt: 13, phoneId: "b", deleted: false, addedAt: 13 }],
      preferences: [
        { id: "settings.theme", changedAt: 14, phoneId: "b", deleted: false, value: '{"a":"b"}' },
      ],
      plays: [play(1)],
      follows: [
        {
          id: "the beatles",
          changedAt: 15,
          phoneId: "b",
          deleted: false,
          name: "The Beatles",
          level: "releases",
          followedAt: 15,
          deezerId: 1,
          ytBrowseId: null,
        },
      ],
      hiddenReleases: [{ id: "deezer:1", changedAt: 16, phoneId: "b", deleted: false }],
      notifiedShows: [{ id: "event-1", changedAt: 17, phoneId: "b", deleted: true }],
      dismissedSuggestions: [
        { id: "massive attack", changedAt: 18, phoneId: "b", deleted: false, dismissedAt: 18 },
      ],
      dislikes: [{ id: "yt:4D7u5KF7SP8", changedAt: 19, phoneId: "b", deleted: true }],
      cursor: "42",
      more: true,
    };

    assert.deepEqual(readPullPage(JSON.stringify(body)), {
      ...body,
      plays: [{ ...play(1), snapshot: null, videoId: null }],
    });
  });

  test("reads follows with their level and ids, hidden releases and notified shows", () => {
    const follow = {
      id: "massive attack",
      changedAt: 20,
      phoneId: "b",
      deleted: false,
      name: "Massive Attack",
      level: "shows",
      followedAt: 18,
      deezerId: 2_163,
      ytBrowseId: "UCQ2f9WmyRrpUQ8xv3IxhPOQ",
    };
    const body = {
      follows: [
        follow,
        { ...follow, id: "portishead", name: "Portishead", level: "releases", deezerId: null },
        { ...follow, id: "tricky", level: "everything" },
        { id: "bjork", changedAt: 21, phoneId: "b", deleted: true },
      ],
      hiddenReleases: [{ id: "deezer:302127", changedAt: 22, phoneId: "b", deleted: false }],
      notifiedShows: [{ id: "G5vYZ9Ma1Jb5U", changedAt: 23, phoneId: "b", deleted: false }],
      cursor: "23",
      more: false,
    };

    assert.deepEqual(readPullPage(JSON.stringify(body)), {
      ...EMPTY_SYNC_TABLES,
      follows: [
        follow,
        { ...follow, id: "portishead", name: "Portishead", level: "releases", deezerId: null },
        { id: "bjork", changedAt: 21, phoneId: "b", deleted: true },
      ],
      hiddenReleases: body.hiddenReleases,
      notifiedShows: body.notifiedShows,
      cursor: "23",
      more: false,
    });
  });

  test("reads dismissed follow suggestions with when they were dismissed, and their tombstones", () => {
    const dismissal = {
      id: "massive attack",
      changedAt: 30,
      phoneId: "b",
      deleted: false,
      dismissedAt: 29,
    };
    const body = {
      dismissedSuggestions: [
        dismissal,
        { id: "portishead", changedAt: 31, phoneId: "b", deleted: true },
        { id: "tricky", changedAt: 32, phoneId: "b", deleted: false },
        { id: "bjork", changedAt: 33, phoneId: "b", deleted: false, dismissedAt: "today" },
      ],
      cursor: "33",
      more: false,
    };

    assert.deepEqual(readPullPage(JSON.stringify(body)), {
      ...EMPTY_SYNC_TABLES,
      dismissedSuggestions: [
        dismissal,
        { id: "portishead", changedAt: 31, phoneId: "b", deleted: true },
      ],
      cursor: "33",
      more: false,
    });
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

  test("a push body names only the tables with rows, so an older service still takes it", () => {
    const favorites = [
      { id: KEY, changedAt: 5, phoneId: "a", deleted: false as const, addedAt: 5 },
    ];
    const [batch] = pushBatches({ ...EMPTY_SYNC_TABLES, favorites });

    assert.ok(batch !== undefined);
    assert.deepEqual(JSON.parse(pushBody(batch)), { favorites });
  });

  test("a dismissal and its Undo go up in a push body", () => {
    const dismissedSuggestions = [
      { id: "massive attack", changedAt: 5, phoneId: "a", deleted: false as const, dismissedAt: 5 },
      { id: "portishead", changedAt: 6, phoneId: "a", deleted: true as const },
    ];
    const [batch] = pushBatches({ ...EMPTY_SYNC_TABLES, dismissedSuggestions });

    assert.ok(batch !== undefined);
    assert.deepEqual(JSON.parse(pushBody(batch)), { dismissedSuggestions });
  });

  test("reads dislikes of Library and YT Music songs, and their removals", () => {
    const disliked = {
      id: KEY,
      changedAt: 40,
      phoneId: "b",
      deleted: false,
      title: "Something",
      artists: '["The Beatles"]',
      durationMs: 182_000,
      dislikedAt: 40,
    };
    const streamed = { ...disliked, id: "yt:4D7u5KF7SP8", durationMs: null };
    const body = {
      dislikes: [
        disliked,
        streamed,
        { id: "yt:removed", changedAt: 41, phoneId: "b", deleted: true },
        { ...disliked, id: "yt:unreadable", artists: ["The Beatles"] },
      ],
      cursor: "41",
      more: false,
    };

    assert.deepEqual(readPullPage(JSON.stringify(body)), {
      ...EMPTY_SYNC_TABLES,
      dislikes: [
        disliked,
        streamed,
        { id: "yt:removed", changedAt: 41, phoneId: "b", deleted: true },
      ],
      cursor: "41",
      more: false,
    });
  });

  test("a dislike and its removal go up in a push body, after the rows of older tables", () => {
    const dislikes = [
      {
        id: KEY,
        changedAt: 5,
        phoneId: "a",
        deleted: false as const,
        title: "Something",
        artists: '["The Beatles"]',
        durationMs: 182_000,
        dislikedAt: 5,
      },
      { id: "yt:4D7u5KF7SP8", changedAt: 6, phoneId: "a", deleted: true as const },
    ];
    const favorites = [{ id: KEY, changedAt: 4, phoneId: "a", deleted: true as const }];
    const [batch] = pushBatches({ ...EMPTY_SYNC_TABLES, favorites, dislikes });

    assert.ok(batch !== undefined);
    assert.deepEqual(Object.keys(JSON.parse(pushBody(batch))), ["favorites", "dislikes"]);
    assert.deepEqual(JSON.parse(pushBody(batch)), { favorites, dislikes });
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

describe("readPushAnswer", () => {
  test("gives the rows the service stored with another change time", () => {
    const answer = readPushAnswer(
      JSON.stringify({
        accepted: { playlists: 1, favorites: 2 },
        corrected: {
          playlists: [{ id: "p1", changedAt: 5_000 }],
          favorites: [
            { id: "f1", changedAt: 5_000 },
            { id: "f2", changedAt: 5_000 },
          ],
        },
      }),
    );
    assert.deepEqual(answer.corrected, [
      { table: "playlists", id: "p1", changedAt: 5_000 },
      { table: "favorites", id: "f1", changedAt: 5_000 },
      { table: "favorites", id: "f2", changedAt: 5_000 },
    ]);
  });

  test("an answer from a service that corrects nothing has no corrected rows", () => {
    assert.deepEqual(readPushAnswer('{"accepted":{"playlists":1}}').corrected, []);
    assert.deepEqual(readPushAnswer("").corrected, []);
  });

  test("leaves out what isn't a corrected row, and tables it doesn't know or that have no change time", () => {
    const answer = readPushAnswer(
      JSON.stringify({
        corrected: {
          playlists: [
            { id: "p1", changedAt: "soon" },
            { id: 7, changedAt: 1 },
            null,
            { id: "p2", changedAt: 3 },
          ],
          plays: [{ id: "x", changedAt: 1 }],
          members: [{ id: "m", changedAt: 1 }],
          favorites: "all",
        },
      }),
    );
    assert.deepEqual(answer.corrected, [{ table: "playlists", id: "p2", changedAt: 3 }]);
  });
});
