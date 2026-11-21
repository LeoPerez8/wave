/// <reference types="node" />
import { statsWindow, type PlayEvent, type StatsWindow, type YtAlbumSong } from "@wave/core";
import assert from "node:assert/strict";
import { test } from "node:test";

import { creditSplits, relinkCredits } from "./credits.ts";
import { keptPlayedTotals, settleKeptTotals } from "./keptPlayTotals.ts";
import { recordPlay } from "./playHistory.ts";
import { summedPlayedTotals } from "./playedEntities.ts";
import { addTrack, openTestDatabase, type TestDatabase } from "./testDatabase.ts";

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 10, 21, 15, 30);

const streamed = (videoId: string, artists: string[], album: string, albumId: string | null) =>
  ({
    videoId,
    title: `Song ${videoId}`,
    artists,
    album,
    albumId,
    artworkUrl: "https://cover",
    durationMs: 180_000,
    explicit: false,
  }) satisfies YtAlbumSong;

const play = (trackId: string, startedAt: number, counted = true): PlayEvent => ({
  trackId,
  context: null,
  startedAt,
  listenedMs: counted ? 180_000 : 5_000,
  durationMs: 180_000,
  endReason: counted ? "completed" : "skipped",
  counted,
  source: "phone",
});

/** Settles every owed step, as the startup job does. */
const settle = (db: TestDatabase) => {
  for (let step = 0; step < 1_000; step++) if (settleKeptTotals(db, { songs: 50 })) return;
  throw new Error("kept totals never settled");
};

const WINDOWS: readonly StatsWindow[] = [
  statsWindow("week", NOW),
  statsWindow("month", NOW),
  statsWindow("year", NOW),
  statsWindow("all", NOW),
  { from: NOW - 14 * DAY, to: NOW },
  { from: NOW - 3_600_000, to: NOW },
];

/** Kept totals equal today's sum over the history for each window, albums and artists. */
const assertSameTotals = (db: TestDatabase) => {
  for (const window of WINDOWS) {
    const kept = keptPlayedTotals(db, window, true);
    assert.notEqual(kept, null, `kept totals settled for ${JSON.stringify(window)}`);
    assert.deepEqual(kept, summedPlayedTotals(db, window, true), JSON.stringify(window));
  }
};

/** A Library with a collaboration, a compilation and plays over a year and a half, streamed ones too. */
const library = async () => {
  const db = await openTestDatabase();
  const solo = addTrack(db, { title: "Solo", artist: "A", album: "First" });
  const duet = addTrack(db, { title: "Duet", artist: "A & B", album: "First" });
  const various = addTrack(db, {
    title: "Mix",
    artist: "C",
    album: "Hits",
    albumArtist: "Various Artists",
  });
  relinkCredits(db, creditSplits());
  const songs = [
    String(solo),
    String(duet),
    String(various),
    "yt:online-1",
    "yt:online-2",
    "yt:library-a",
  ];
  const meta: Record<string, YtAlbumSong> = {
    "yt:online-1": streamed("online-1", ["D", "E"], "Online album", "MPREb_online"),
    "yt:online-2": streamed("online-2", ["D"], "Online album", "MPREb_online"),
    "yt:library-a": streamed("library-a", ["A"], "First", null),
  };
  // Plays every ~7 hours over 540 days, one in four skipped.
  for (let index = 0; index < 1_850; index++) {
    const id = songs[index % songs.length]!;
    recordPlay(db, play(id, NOW - index * 25_200_000, index % 4 !== 0), false, meta[id]);
  }
  return { db, solo, duet, various, meta };
};

test("settled kept totals equal today's sum for Library and streamed plays in every window", async () => {
  const { db } = await library();
  settle(db);
  assertSameTotals(db);
});
