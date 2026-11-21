/// <reference types="node" />
import {
  EMPTY_SYNC_TABLES,
  readPullPage,
  statsWindow,
  type FollowRelease,
  type PlayEvent,
  type StatsWindow,
  type YtAlbumSong,
} from "@wave/core";
import assert from "node:assert/strict";
import { test } from "node:test";

import { sql } from "drizzle-orm";

import { saveImportedPlays } from "./blackPlayer.ts";
import { creditSplits, relinkCredits } from "./credits.ts";
import { followReleaseListening } from "./followReleases.ts";
import { selectPlaylistPlays } from "./playlists.ts";
import {
  keptCreditedPlayTotals,
  keptPlayedTotals,
  keptSongPlayTotals,
  keptTotalsSettled,
  settleKeptTotals,
} from "./keptPlayTotals.ts";
import { homePlays, recordPlay, updatePlay } from "./playHistory.ts";
import {
  playedEntityTotals,
  summedPlayedTotals,
  type PlayedEntityTotal,
  type PlayedEntityTotals,
} from "./playedEntities.ts";
import { summedCreditedPlayTotals, summedSongPlayTotals } from "./stats.ts";
import { identifyImportedPlays } from "./sync.ts";
import { applyPulledPage, selectAccountTrackIds, selectUnpushed } from "./syncRows.ts";
import { deleteTracksById } from "./tracks.ts";
import { migrateDatabase } from "../database.ts";
import migrations from "./migrations.ts";
import type { LibraryDatabase } from "./database.ts";
import { readConnections, replayRead } from "./offThreadReads.ts";
import {
  addTrack,
  asyncReadClient,
  openTestDatabase,
  traceQueries,
  type TestDatabase,
  type TracedQuery,
} from "./testDatabase.ts";

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

/** Rows in no order, as one order: those reads promise none. */
const unordered = <A>(rows: readonly A[] | null) =>
  rows === null ? null : rows.map((row) => JSON.stringify(row)).sort();

/**
 * Kept totals equal today's sum over the history for each window: albums
 * and artists, songs, and Stats' credit rows.
 */
const assertSameTotals = (db: TestDatabase) => {
  for (const window of WINDOWS) {
    const label = JSON.stringify(window);
    const kept = keptPlayedTotals(db, window, true);
    assert.notEqual(kept, null, `kept totals settled for ${label}`);
    assert.deepEqual(comparable(kept!), comparable(summedPlayedTotals(db, window, true)), label);
    assert.deepEqual(
      unordered(keptSongPlayTotals(db, window)),
      unordered(summedSongPlayTotals(db, window)),
      `songs ${label}`,
    );
    assert.deepEqual(
      unordered(keptCreditedPlayTotals(db, window)),
      unordered(summedCreditedPlayTotals(db, window)),
      `credits ${label}`,
    );
  }
};

/** A Library with a collaboration, a compilation and plays over a year and a half, streamed ones too. */
const library = async (options: { readonly through?: string } = {}) => {
  const db = await openTestDatabase(options);
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

/** Whether a traced statement walked the whole play history. */
const scansHistory = (query: TracedQuery) =>
  query.plan.some((step) => /^SCAN (play_events|e)\b/u.test(step));

test("an upgrade sums its history after startup in bounded steps, reading today's sum until then", async () => {
  const { db } = await library({ through: "0064_pull_dislikes" });
  const before = summedPlayedTotals(db, statsWindow("year", NOW), true);
  // The migration only notes the last play: the history is summed by the steps below.
  migrateDatabase(db, migrations);
  assert.equal(keptTotalsSettled(db), false);
  assert.deepEqual(playedEntityTotals(db, statsWindow("year", NOW)), before);
  let steps = 0;
  for (; steps < 1_000; steps++) {
    const step = traceQueries(db, () => settleKeptTotals(db, { songs: 2, plays: 500 }));
    assert.deepEqual(step.queries.filter(scansHistory), [], `step ${steps} reads part of the history`);
    if (step.result) break;
  }
  // 1,850 plays seeded 500 at a time, six songs summed and credited two at a time.
  assert.equal(steps, 4 + 3 + 3 - 1);
  assertSameTotals(db);
});

test("a kept read searches only the plays of its window's partial days", async () => {
  const { db } = await library();
  settle(db);
  for (const window of WINDOWS) {
    const read = traceQueries(db, () => keptPlayedTotals(db, window, true));
    assert.deepEqual(read.queries.filter(scansHistory), [], JSON.stringify(window));
  }
});

/** Makes every song owe its credits, so readers sum from the history as before #1349. */
const unsettle = (db: TestDatabase) => db.run(sql`UPDATE played_songs SET state = 1`);

test("Home's plays read the kept credits: the same shelves, without reading every artist", async () => {
  const { db } = await library();
  recordPlay(db, play("yt:skipped-only", NOW - DAY, false), false, streamed("skipped-only", ["H"], "Skipped album", null));
  unsettle(db);
  const summed = homePlays(db);
  settle(db);
  const kept = traceQueries(db, () => homePlays(db));
  assert.deepEqual(kept.result, summed);
  assert.deepEqual(
    kept.queries.filter((query) => query.plan.some((step) => /^SCAN (artists|albums)\b/u.test(step))),
    [],
  );
});

test("release listening finds counted recordings in the kept totals, not by scanning the plays", async () => {
  const { db, solo } = await library({ through: "0064_pull_dislikes" });
  const keys = db
    .all<{ key: string }>(sql`SELECT DISTINCT recording_key AS key FROM play_events ORDER BY 1`)
    .map((row) => row.key);
  const release: FollowRelease = {
    key: "deezer:9",
    artistKey: "nobody",
    title: "Elsewhere",
    type: "album",
    releaseDate: "2026-10-29",
    artworkUrl: null,
    explicit: false,
    browseId: null,
    videoIds: [],
    recordingKeys: [...keys, "never-played"],
  };
  const before = followReleaseListening(db, [release]);
  migrateDatabase(db, migrations);
  // A play from before the upgrade leaves before its plays are seeded.
  db.run(sql`DELETE FROM play_events WHERE track_id = ${solo} AND counted`);
  settle(db);
  const after = traceQueries(db, () => followReleaseListening(db, [release]));
  assert.deepEqual(after.queries.filter(scansHistory), []);
  const expected = new Set(before.countedPlays);
  for (const key of db
    .all<{ key: string }>(sql`SELECT recording_key AS key FROM play_events WHERE track_id = ${solo}`)
    .map((row) => row.key))
    expected.delete(key);
  assert.deepEqual([...after.result.countedPlays].sort(), [...expected].sort());
});

test("the playlists' plays come from kept counts, also over an upgrade's history", async () => {
  const { db, solo, duet } = await library({ through: "0064_pull_dislikes" });
  const fromPlaylist = (trackId: number, playlist: string, at: number, counted = true): PlayEvent => ({
    ...play(String(trackId), at, counted),
    context: { kind: "playlist", id: playlist },
  });
  for (let index = 0; index < 120; index++)
    recordPlay(db, fromPlaylist(index % 2 ? solo : duet, index % 3 ? "7" : "12", NOW - index * 9_000_000, index % 5 !== 0));
  migrateDatabase(db, migrations);
  recordPlay(db, fromPlaylist(solo, "07", NOW - 1_000));
  db.run(sql`DELETE FROM play_events WHERE context_id = '12' AND started_at > ${NOW - 2 * DAY}`);
  const expected = selectPlaylistPlays(db, NOW);
  settle(db);
  const kept = traceQueries(db, () => selectPlaylistPlays(db, NOW));
  assert.deepEqual(kept.result, expected);
  assert.ok(expected.length === 2 && expected.every((playlist) => playlist.recentPlays > 0));
  assert.deepEqual(
    kept.queries.filter((query) => query.plan.some((step) => /play_events_context_idx/u.test(step))),
    [],
  );
});

test("the kept reads replay off the JS thread with the same totals", async () => {
  const { db } = await library();
  settle(db);
  const reads = readConnections(async () => asyncReadClient(db));
  const window = statsWindow("month", NOW);
  for (const read of [
    (d: LibraryDatabase) => playedEntityTotals(d, window),
    (d: LibraryDatabase) => keptSongPlayTotals(d, window),
    (d: LibraryDatabase) => keptCreditedPlayTotals(d, window),
    (d: LibraryDatabase) => homePlays(d),
    (d: LibraryDatabase) => selectPlaylistPlays(d, NOW),
  ]) {
    const replayed = await replayRead(reads, read as (d: LibraryDatabase) => unknown, () => 0);
    assert.deepEqual(replayed.value, read(db));
  }
});
