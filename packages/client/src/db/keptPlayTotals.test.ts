/// <reference types="node" />
import {
  EMPTY_SYNC_TABLES,
  readPullPage,
  statsWindow,
  type PlayEvent, type StatsWindow, type YtAlbumSong } from "@wave/core";
import assert from "node:assert/strict";
import { test } from "node:test";

import { sql } from "drizzle-orm";

import { saveImportedPlays } from "./blackPlayer.ts";
import { creditSplits, relinkCredits } from "./credits.ts";
import { keptPlayedTotals, keptTotalsSettled, settleKeptTotals } from "./keptPlayTotals.ts";
import { recordPlay, updatePlay } from "./playHistory.ts";
import {
  summedPlayedTotals,
  type PlayedEntityTotal,
  type PlayedEntityTotals,
} from "./playedEntities.ts";
import { identifyImportedPlays } from "./sync.ts";
import { applyPulledPage, selectAccountTrackIds, selectUnpushed } from "./syncRows.ts";
import { deleteTracksById } from "./tracks.ts";
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

/**
 * An online album's or artist's details come from one of its songs: today's
 * sum takes whichever it met last, the kept totals the latest played (tested
 * on its own below). Everything else is compared whole.
 */
const comparable = (totals: PlayedEntityTotals) => {
  const named = <A extends { readonly id: number | string }>(entry: PlayedEntityTotal<A>) =>
    typeof entry.id === "string" ? { ...entry, item: { id: entry.id } } : entry;
  return { albums: totals.albums.map(named), artists: totals.artists.map(named) };
};

/** Kept totals equal today's sum over the history for each window, albums and artists. */
const assertSameTotals = (db: TestDatabase) => {
  for (const window of WINDOWS) {
    const kept = keptPlayedTotals(db, window, true);
    assert.notEqual(kept, null, `kept totals settled for ${JSON.stringify(window)}`);
    assert.deepEqual(
      comparable(kept!),
      comparable(summedPlayedTotals(db, window, true)),
      JSON.stringify(window),
    );
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

test("a BlackPlayer import is in the kept totals once settled", async () => {
  const { db, solo, various } = await library();
  settle(db);
  saveImportedPlays(
    db,
    Array.from({ length: 400 }, (_, index) => ({
      trackId: index % 3 === 0 ? various : solo,
      startedAt: NOW - index * 3_600_000 - 1_234,
    })),
  );
  identifyImportedPlays(db);
  settle(db);
  assertSameTotals(db);
});

test("plays pulled from another phone are in the kept totals once settled", async () => {
  const { db } = await library();
  settle(db);
  const other = await openTestDatabase();
  const id = addTrack(other, { title: "Duet", artist: "A & B", album: "First" });
  relinkCredits(other, creditSplits());
  for (let index = 0; index < 60; index++)
    recordPlay(other, play(String(id), NOW - index * 5_000_000 - 77));
  recordPlay(
    other,
    play("yt:pulled", NOW - 40 * DAY),
    false,
    streamed("pulled", ["F"], "Pulled album", "MPREb_pulled"),
  );
  const page = readPullPage(
    JSON.stringify({
      ...EMPTY_SYNC_TABLES,
      ...selectUnpushed(other, 1_000, () => null).rows,
      cursor: "1",
      more: false,
    }),
  );
  assert.ok(page);
  applyPulledPage(db, page, selectAccountTrackIds(db), NOW);
  settle(db);
  assertSameTotals(db);
});

test("a deleted song keeps counting for its album and artists, as today's sum counts it", async () => {
  const { db, duet } = await library();
  settle(db);
  deleteTracksById(db, [duet]);
  settle(db);
  assertSameTotals(db);
});

test("a streamed song downloaded later counts as the Library song", async () => {
  const { db } = await library();
  settle(db);
  const downloaded = addTrack(db, { title: "Song online-1", artist: "D, E", album: "Online album" });
  db.run(sql`UPDATE tracks SET video_id = 'online-1' WHERE id = ${downloaded}`);
  relinkCredits(db, creditSplits());
  settle(db);
  assertSameTotals(db);
});

test("a play keeps the totals settled within its write: no step owed after it", async () => {
  const { db, solo, meta } = await library();
  settle(db);
  const fresh = addTrack(db, { title: "Fresh", artist: "A", album: "Second" });
  relinkCredits(db, creditSplits());
  settle(db);
  const started = NOW - 600_000;
  for (const id of [String(solo), String(fresh), "yt:online-1", "yt:new-stream"]) {
    const song =
      id === "yt:new-stream"
        ? streamed("new-stream", ["D", "G"], "Fresh online album", "MPREb_fresh")
        : meta[id];
    const playId = recordPlay(db, play(id, started, false), false, song);
    updatePlay(db, playId, play(id, started));
    assert.equal(keptTotalsSettled(db), true, `settled after a play of ${id}`);
  }
  assertSameTotals(db);
});

test("an online album is named by the latest played song of it, in every window", async () => {
  const db = await openTestDatabase();
  const older = streamed("b-older", ["D", "G"], "Online album", "MPREb_online");
  const latest = streamed("a-latest", ["D"], "Online album", "MPREb_online");
  recordPlay(db, play("yt:b-older", NOW - 2 * DAY), false, older);
  recordPlay(db, play("yt:a-latest", NOW - DAY), false, latest);
  settle(db);
  for (const window of WINDOWS.slice(0, 4)) {
    const album = keptPlayedTotals(db, window, true)!.albums[0]!;
    assert.deepEqual([album.countedPlays, album.item.albumArtist], [2, "D"]);
  }
});
