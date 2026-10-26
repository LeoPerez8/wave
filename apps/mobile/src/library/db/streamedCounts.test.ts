/// <reference types="node" />
import { normalizeTrack, type PlayEvent, type StatsWindow, type YtAlbumSong } from "@wave/core";
import { sql } from "drizzle-orm";
import assert from "node:assert/strict";
import { beforeEach, describe, test } from "node:test";

import type { IndexedTrack } from "../LibraryStore.ts";
import { creditSplits } from "./credits.ts";
import { homePlays, recordPlay, type MostPlayedRow } from "./playHistory.ts";
import { listeningSums } from "./playTotals.ts";
import { saveBatch } from "./save.ts";
import { songPlayTotals } from "./stats.ts";
import {
  addTrack,
  migrateTestDatabase,
  openTestDatabase,
  traceQueries,
  type TestDatabase,
} from "./testDatabase.ts";

let db: TestDatabase;

beforeEach(async () => {
  db = await openTestDatabase();
});

const airbag: YtAlbumSong = {
  videoId: "v-airbag",
  title: "Airbag",
  artists: ["Radiohead"],
  album: "OK Computer",
  durationMs: 284_000,
  artworkUrl: "https://i.ytimg.com/airbag.jpg",
  explicit: false,
  albumId: "MPREb_ok",
};

/** A counted play of the Library song [trackId] that started at [startedAt]. */
const play = (
  trackId: number | string,
  startedAt: number,
  overrides: Partial<PlayEvent> = {},
): PlayEvent => ({
  trackId: String(trackId),
  context: null,
  startedAt,
  listenedMs: 180_000,
  durationMs: 180_000,
  endReason: "completed",
  counted: true,
  source: "phone",
  ...overrides,
});

/** A counted play of the streamed [song], as the player records it. */
const stream = (song: YtAlbumSong, startedAt: number, overrides: Partial<PlayEvent> = {}) =>
  recordPlay(db, play(`yt:${song.videoId}`, startedAt, overrides), false, song);

/**
 * Saves [title] by Radiohead on OK Computer as a scan or a finished download
 * does (a download keeps its [videoId]); returns its id. Without a track
 * number its recording key is the one a streamed play of it gets.
 */
const download = (
  title: string,
  { videoId, trackNumber }: { videoId?: string; trackNumber?: string } = {},
): number => {
  const track: IndexedTrack = {
    ...normalizeTrack({
      path: `/Music/${title}.m4a`,
      title,
      artist: "Radiohead",
      album: "OK Computer",
      trackNumber,
      durationMs: 284_000,
    }),
    sizeBytes: 1_000,
    modifiedAt: 0,
    sampleRate: null,
    bitrateKbps: null,
    artworkHash: null,
    hasLyrics: false,
    explicit: "unknown",
    ...(videoId === undefined ? {} : { videoId }),
  };
  saveBatch(db, creditSplits(), [track], [], [], 0);
  return db.get<{ id: number }>(sql`SELECT id FROM tracks WHERE path = ${track.path}`).id;
};

const ALL = { from: null, to: 1_000_000 };

/** Each song's counted plays in [window], by Library id or video id. */
const songCounts = (window: StatsWindow = ALL) =>
  songPlayTotals(db, window)
    .map((entry) => [
      entry.song.kind === "library" ? entry.song.id : entry.song.videoId,
      entry.countedPlays,
    ])
    .toSorted(([a], [b]) => String(a).localeCompare(String(b)));

describe("Stats' song totals with streamed plays", () => {
  test("a streamed song is one entry across its counted plays, by video id", () => {
    const library = addTrack(db, { title: "So What" });
    recordPlay(db, play(library, 1_000));
    for (let i = 0; i < 5; i++) stream(airbag, 2_000 + i, { listenedMs: 100_000 });
    stream(airbag, 3_000, { counted: false, listenedMs: 5_000, endReason: "skipped" });

    const totals = songPlayTotals(db, ALL);
    assert.deepEqual(
      totals.find((entry) => entry.song.kind === "yt"),
      {
        song: { kind: "yt", videoId: "v-airbag" },
        sortKey: "airbag",
        countedPlays: 5,
        listenedMs: 500_000,
        latestPlayAt: 2_004,
      },
    );
    assert.deepEqual(songCounts(), [
      [library, 1],
      ["v-airbag", 5],
    ]);
    assert.deepEqual(songCounts({ from: 2_003, to: 10_000 }), [["v-airbag", 2]]);
  });

  test("downloading the song leaves one entry with all its plays, and the file's plays add to it", () => {
    for (let i = 0; i < 5; i++) stream(airbag, 1_000 + i);
    const downloaded = download("Airbag", { videoId: "v-airbag", trackNumber: "1" });
    assert.deepEqual(songCounts(), [[downloaded, 5]]);

    recordPlay(db, play(downloaded, 2_000));
    recordPlay(db, play(downloaded, 2_001));
    const [song] = songPlayTotals(db, ALL);
    assert.deepEqual(song, {
      song: { kind: "library", id: downloaded },
      sortKey: "airbag",
      countedPlays: 7,
      listenedMs: 7 * 180_000,
      latestPlayAt: 2_001,
    });
  });

  test("a Library song with the same recording key takes the streamed plays too", () => {
    stream(airbag, 1_000);
    stream({ ...airbag, videoId: "v-airbag-video" }, 1_001);
    const scanned = download("Airbag");
    recordPlay(db, play(scanned, 2_000));
    assert.deepEqual(songCounts(), [[scanned, 3]]);
  });
});

describe("Listening totals with streamed plays", () => {
  test("time, plays and songs listened include streamed plays", () => {
    const library = addTrack(db, { title: "So What" });
    recordPlay(db, play(library, 1_000));
    for (let i = 0; i < 5; i++) stream(airbag, 2_000 + i, { listenedMs: 100_000 });
    stream(airbag, 3_000, { counted: false, listenedMs: 5_000, endReason: "skipped" });
    stream({ ...airbag, videoId: "v-skipped" }, 3_001, {
      counted: false,
      listenedMs: 1_000,
      endReason: "skipped",
    });

    assert.deepEqual(listeningSums(db), {
      listenedMs: 180_000 + 500_000 + 5_000 + 1_000,
      countedPlays: 6,
      songsListened: 2,
      lastPlayedAt: 3_001,
    });
  });

  test("a downloaded song is one song listened, whose plays are streamed and from its file", () => {
    stream(airbag, 1_000);
    stream({ ...airbag, videoId: "v-airbag-video" }, 1_001);
    const before = listeningSums(db);
    assert.equal(before.songsListened, 2);
    // Tagged with a track number, its recording key isn't the streamed one: only its video's plays are its.
    const downloaded = download("Airbag", { videoId: "v-airbag", trackNumber: "1" });
    assert.deepEqual(listeningSums(db), before);
    recordPlay(db, play(downloaded, 2_000));
    assert.deepEqual(listeningSums(db), {
      listenedMs: 3 * 180_000,
      countedPlays: 3,
      songsListened: 2,
      lastPlayedAt: 2_000,
    });
  });

  test("two videos of one Library song are one song listened", () => {
    stream(airbag, 1_000);
    stream({ ...airbag, videoId: "v-airbag-video" }, 1_001);
    download("Airbag", { videoId: "v-airbag" });
    assert.equal(listeningSums(db).songsListened, 1);
  });

  test("streamed plays kept as they're written: a play that grows, or one deleted", () => {
    const id = stream(airbag, 1_000, { counted: false, listenedMs: 1_000, endReason: "skipped" });
    assert.equal(listeningSums(db).countedPlays, 0);
    db.run(sql`UPDATE play_events SET counted = 1, listened_ms = 60000 WHERE id = ${id}`);
    assert.deepEqual(listeningSums(db), {
      listenedMs: 60_000,
      countedPlays: 1,
      songsListened: 1,
      lastPlayedAt: 1_000,
    });
    db.run(sql`DELETE FROM play_events WHERE id = ${id}`);
    assert.deepEqual(listeningSums(db), {
      listenedMs: 0,
      countedPlays: 0,
      songsListened: 0,
      lastPlayedAt: null,
    });
  });

  test("upgrading sums the streamed plays recorded before", async () => {
    db = await openTestDatabase({ through: "0041_synced_play_snapshots" });
    stream(airbag, 1_000);
    stream(airbag, 2_000, { counted: false, listenedMs: 1_000, endReason: "skipped" });
    await migrateTestDatabase(db);
    assert.deepEqual(listeningSums(db), {
      listenedMs: 181_000,
      countedPlays: 1,
      songsListened: 1,
      lastPlayedAt: 2_000,
    });
  });

  test("read the kept totals, never the play history", () => {
    for (let i = 0; i < 20; i++) stream({ ...airbag, videoId: `v-${i}` }, 1_000 + i);
    download("Airbag", { videoId: "v-3" });
    for (const query of traceQueries(db, () => listeningSums(db)).queries) {
      assert.deepEqual(
        query.plan.filter((step) => /SCAN (play_events|tracks)/.test(step)),
        [],
        query.sql,
      );
    }
  });
});

/** Home's Most played as [title, plays, streamed?] rows. */
const mostPlayed = (scope: "library" | "files" = "library") =>
  homePlays(db, scope).mostPlayed.map((row: MostPlayedRow) =>
    row.source === "library"
      ? [row.track.title, row.playCount]
      : [row.song.title, row.playCount, "streamed"],
  );

describe("Home's Most played with streamed plays", () => {
  test("a streamed song played 5 times ranks with 5 plays, as the streamed song", () => {
    const library = addTrack(db, { title: "So What" });
    for (const at of [1_000, 1_001]) recordPlay(db, play(library, at));
    for (let i = 0; i < 5; i++) stream(airbag, 2_000 + i);
    stream({ ...airbag, videoId: "v-once", title: "Once" }, 3_000);

    assert.deepEqual(mostPlayed(), [
      ["Airbag", 5, "streamed"],
      ["So What", 2],
      ["Once", 1, "streamed"],
    ]);
    const [top] = homePlays(db).mostPlayed;
    assert.deepEqual(top?.source === "stream" ? top.song : null, airbag);
  });

  test("downloading the song leaves one row with all its plays, and the file's plays add to it", () => {
    const other = addTrack(db, { title: "So What" });
    for (let i = 0; i < 6; i++) recordPlay(db, play(other, 1_000 + i));
    for (let i = 0; i < 5; i++) stream(airbag, 2_000 + i);
    const downloaded = download("Airbag", { videoId: "v-airbag", trackNumber: "1" });
    assert.deepEqual(mostPlayed(), [
      ["So What", 6],
      ["Airbag", 5],
    ]);
    recordPlay(db, play(downloaded, 3_000));
    recordPlay(db, play(downloaded, 3_001));
    assert.deepEqual(mostPlayed(), [
      ["Airbag", 7],
      ["So What", 6],
    ]);
  });

  test("a song outside the top ten by its file's plays climbs in with its streamed ones", () => {
    for (let n = 0; n < 10; n++) {
      const track = addTrack(db, { title: `Song ${n}` });
      for (let i = 0; i < 3; i++) recordPlay(db, play(track, 1_000 + n * 10 + i));
    }
    const downloaded = download("Airbag", { videoId: "v-airbag", trackNumber: "1" });
    recordPlay(db, play(downloaded, 5_000));
    for (let i = 0; i < 3; i++) stream(airbag, 6_000 + i);
    assert.deepEqual(mostPlayed()[0], ["Airbag", 4]);
    assert.equal(mostPlayed().length, 10);
  });

  test("Android Auto's lists only songs with a file", () => {
    const library = addTrack(db, { title: "So What" });
    recordPlay(db, play(library, 1_000));
    for (let i = 0; i < 5; i++) stream(airbag, 2_000 + i);
    stream({ ...airbag, videoId: "v-other", title: "Lucky" }, 3_000);
    assert.deepEqual(mostPlayed("files"), [["So What", 1]]);
    download("Lucky", { videoId: "v-other", trackNumber: "2" });
    assert.deepEqual(mostPlayed("files"), [
      ["Lucky", 1],
      ["So What", 1],
    ]);
  });

  test("read the kept totals, never the play history", () => {
    for (let i = 0; i < 20; i++) stream({ ...airbag, videoId: `v-${i}` }, 1_000 + i);
    const track = download("Airbag", { videoId: "v-3" });
    recordPlay(db, play(track, 5_000));
    for (const scope of ["library", "files"] as const) {
      for (const query of traceQueries(db, () => homePlays(db, scope)).queries) {
        assert.deepEqual(
          query.plan.filter((step) => /SCAN (play_events|tracks)/.test(step)),
          [],
          query.sql,
        );
      }
    }
  });
});
