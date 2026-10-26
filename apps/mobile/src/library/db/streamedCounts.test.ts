/// <reference types="node" />
import { normalizeTrack, type PlayEvent, type YtAlbumSong } from "@wave/core";
import { sql } from "drizzle-orm";
import assert from "node:assert/strict";
import { beforeEach, describe, test } from "node:test";

import type { IndexedTrack } from "../LibraryStore.ts";
import { creditSplits } from "./credits.ts";
import { recordPlay } from "./playHistory.ts";
import { saveBatch } from "./save.ts";
import { songPlayTotals } from "./stats.ts";
import { addTrack, openTestDatabase, type TestDatabase } from "./testDatabase.ts";

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
const songCounts = (window = ALL) =>
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
