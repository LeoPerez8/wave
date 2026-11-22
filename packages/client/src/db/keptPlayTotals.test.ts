/// <reference types="node" />
import {
  EMPTY_SYNC_TABLES,
  finishSteps,
  normalizeTrack,
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

import type { IndexedTrack } from "../types.ts";
import { saveImportedPlays } from "./blackPlayer.ts";
import { creditSplits, relinkCredits } from "./credits.ts";
import { followReleaseListening } from "./followReleases.ts";
import { selectPlaylistPlays } from "./playlists.ts";
import { removeTracks, saveBatch } from "./save.ts";
import {
  keptCreditedPlayTotals,
  keptPlayedTotals,
  keptSongPlayTotals,
  keptTotalsSettled,
  settleKeptTotals,
  settleKeptTotalsSteps,
} from "./keptPlayTotals.ts";
import { homePlays, recordPlay, updatePlay } from "./playHistory.ts";
import {
  playedArtistTotals,
  playedEntityTotals,
  playedTotalsRead,
  playedTotalsSteps,
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
import { finishReplaySteps, readConnections, replayRead } from "./offThreadReads.ts";
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

test("a write to the history only marks its plays' days owed, for the settler to count", async () => {
  const { db, solo } = await library();
  settle(db);
  const owed = () => db.get<{ n: number }>(sql`SELECT count(*) AS n FROM owed_days`).n;
  const buckets = () => db.get<{ n: number }>(sql`SELECT count(*) AS n FROM play_buckets`).n;
  const before = buckets();
  // Plays written as a pull or an import writes them: no play write of the player's.
  for (const [index, startedAt] of [
    NOW - 3 * DAY,
    NOW - 3 * DAY - 60_000,
    NOW - 400 * DAY,
  ].entries())
    db.run(sql`INSERT INTO play_events (track_id, snapshot, recording_key, started_at, listened_ms,
        duration_ms, end_reason, counted, source, sync_id)
      VALUES (${solo}, '{}', 'solo-key', ${startedAt}, 180000, 180000, 'completed', 1, 'phone',
        ${`written-${index}`})`);
  db.run(sql`DELETE FROM play_events WHERE id = (SELECT min(id) FROM play_events)`);
  assert.equal(buckets(), before, "the write sums nothing itself");
  assert.ok(owed() > 0);
  assert.equal(keptTotalsSettled(db), false, "readers sum from the history until it's counted");
  const triggers = db.all<{ body: string }>(
    sql`SELECT sql AS body FROM sqlite_master WHERE type = 'trigger' AND tbl_name = 'play_events'`,
  );
  for (const { body } of triggers) assert.doesNotMatch(body, /play_buckets/);
  // A day per step: the same totals from bounded steps.
  let steps = 0;
  while (!settleKeptTotals(db, { songs: 50, days: 1 })) assert.ok(++steps < 100);
  assert.ok(steps >= 2, "each owed day is a step of its own");
  assert.equal(owed(), 0);
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
  const downloaded = addTrack(db, {
    title: "Song online-1",
    artist: "D, E",
    album: "Online album",
  });
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
  const { db } = await library({ through: "0068_collaborative_playlists" });
  const before = summedPlayedTotals(db, statsWindow("year", NOW), true);
  // The migration only notes the last play: the history is summed by the steps below.
  migrateDatabase(db, migrations);
  assert.equal(keptTotalsSettled(db), false);
  assert.deepEqual(playedEntityTotals(db, statsWindow("year", NOW)), before);
  let steps = 0;
  for (; steps < 1_000; steps++) {
    const step = traceQueries(db, () => settleKeptTotals(db, { songs: 2, plays: 500 }));
    assert.deepEqual(
      step.queries.filter(scansHistory),
      [],
      `step ${steps} reads part of the history`,
    );
    if (step.result) break;
  }
  // 1,850 plays seeded 500 at a time, six songs summed and credited two at a time, after one
  // step builds the streamed songs' resolver.
  assert.equal(steps, 4 + 3 + 1 + 3 - 1);
  assertSameTotals(db);
});

test("a Library change rebuilds the resolver in steps of one read or a little of Core's work", async () => {
  const { db } = await library();
  settle(db);
  // Forty more artists, each with a song: what Core matches streamed songs against changed.
  for (let index = 0; index < 40; index++)
    addTrack(db, { title: `Song ${index}`, artist: `Artist ${index}`, album: `Album ${index}` });
  relinkCredits(db, creditSplits());
  assert.equal(keptTotalsSettled(db), false);
  const statements: number[] = [];
  for (let piece = 0; piece < 1_000; piece++) {
    const steps = settleKeptTotalsSteps(db, { songs: 50 });
    let next: IteratorResult<void, boolean>;
    do {
      const step = traceQueries(db, () => steps.next());
      next = step.result;
      statements.push(step.queries.length);
    } while (next.done !== true);
    if (next.value) break;
  }
  // The rebuild yields at least once per Library artist, and its steps run one read at most.
  const rebuild = statements.filter((count) => count <= 1);
  assert.ok(rebuild.length >= 43, `${rebuild.length} steps of one read at most`);
  assertSameTotals(db);
});

test("a play credits a few owed songs within its write and leaves the rest owed, past eight", async () => {
  const { db } = await library();
  const more = Array.from({ length: 12 }, (_, index) =>
    String(addTrack(db, { title: `More ${index}`, artist: "A", album: "First" })),
  );
  relinkCredits(db, creditSplits());
  for (const id of more) recordPlay(db, play(id, NOW - 7_200_000), false);
  settle(db);
  // Each of them owes its credits again, as after a Library change.
  db.run(
    sql`UPDATE played_songs SET state = 1 WHERE song IN (${sql.join(
      more.map((id) => sql`${`t:${id}`}`),
      sql`, `,
    )})`,
  );
  const owed = () =>
    db.get<{ owed: number }>(sql`SELECT count(*) AS owed FROM played_songs WHERE state = 1`).owed;
  assert.equal(owed(), 12);
  recordPlay(db, play(more[0]!, NOW - 600_000), false);
  assert.equal(owed(), 4);
  recordPlay(db, play(more[1]!, NOW - 300_000), false);
  assert.equal(owed(), 0);
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
  recordPlay(
    db,
    play("yt:skipped-only", NOW - DAY, false),
    false,
    streamed("skipped-only", ["H"], "Skipped album", null),
  );
  unsettle(db);
  const summed = homePlays(db);
  settle(db);
  const kept = traceQueries(db, () => homePlays(db));
  assert.deepEqual(kept.result, summed);
  assert.deepEqual(
    kept.queries.filter((query) =>
      query.plan.some((step) => /^SCAN (artists|albums)\b/u.test(step)),
    ),
    [],
  );
});

test("release listening finds counted recordings in the kept totals, not by scanning the plays", async () => {
  const { db, solo } = await library({ through: "0068_collaborative_playlists" });
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
    .all<{ key: string }>(
      sql`SELECT recording_key AS key FROM play_events WHERE track_id = ${solo}`,
    )
    .map((row) => row.key))
    expected.delete(key);
  assert.deepEqual([...after.result.countedPlays].sort(), [...expected].sort());
});

test("the playlists' plays come from kept counts, also over an upgrade's history", async () => {
  const { db, solo, duet } = await library({ through: "0068_collaborative_playlists" });
  const fromPlaylist = (
    trackId: number,
    playlist: string,
    at: number,
    counted = true,
  ): PlayEvent => ({
    ...play(String(trackId), at, counted),
    context: { kind: "playlist", id: playlist },
  });
  for (let index = 0; index < 120; index++)
    recordPlay(
      db,
      fromPlaylist(
        index % 2 ? solo : duet,
        index % 3 ? "7" : "12",
        NOW - index * 9_000_000,
        index % 5 !== 0,
      ),
    );
  migrateDatabase(db, migrations);
  recordPlay(db, fromPlaylist(solo, "07", NOW - 1_000));
  db.run(sql`DELETE FROM play_events WHERE context_id = '12' AND started_at > ${NOW - 2 * DAY}`);
  const expected = selectPlaylistPlays(db, NOW);
  settle(db);
  const kept = traceQueries(db, () => selectPlaylistPlays(db, NOW));
  assert.deepEqual(kept.result, expected);
  assert.ok(expected.length === 2 && expected.every((playlist) => playlist.recentPlays > 0));
  assert.deepEqual(
    kept.queries.filter((query) =>
      query.plan.some((step) => /play_events_context_idx/u.test(step)),
    ),
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

/** How many steps `playedTotalsSteps` takes over [window]'s read. */
const stepsOf = (db: LibraryDatabase, window: StatsWindow) => {
  const steps = playedTotalsSteps(playedTotalsRead(db, window, true));
  let count = 0;
  while (!steps.next().done) count++;
  return count;
};

test("while the kept totals settle, the summed totals in steps equal the settled ones", async () => {
  const { db } = await library();
  // A streamed song downloaded later: its plays count through the Library song's links.
  const downloaded = addTrack(db, {
    title: "Song online-1",
    artist: "D, E",
    album: "Online album",
  });
  db.run(sql`UPDATE tracks SET video_id = 'online-1' WHERE id = ${downloaded}`);
  relinkCredits(db, creditSplits());
  const downloadedAlbum = db.get<{ albumId: number }>(
    sql`SELECT album_id AS "albumId" FROM tracks WHERE id = ${downloaded}`,
  )!.albumId;
  settle(db);
  const settled = WINDOWS.map((window) => keptPlayedTotals(db, window, true)!);
  const settledArtists = WINDOWS.map((window) => keptPlayedTotals(db, window, false)!.artists);
  unsettle(db);
  assert.equal(keptTotalsSettled(db), false);
  WINDOWS.forEach((window, index) => {
    const label = JSON.stringify(window);
    const stepped = finishSteps(playedTotalsSteps(playedTotalsRead(db, window, true)));
    assert.deepEqual(comparable(stepped), comparable(settled[index]!), label);
    assert.deepEqual(
      comparable({ albums: [], artists: playedArtistTotals(db, window) }),
      comparable({ albums: [], artists: settledArtists[index]! }),
      label,
    );
  });
  // Online albums and the downloaded song's Library album are both in it.
  assert.ok(settled.some((totals) => totals.albums.some((album) => typeof album.id === "string")));
  assert.ok(settled.some((totals) => totals.albums.some((album) => album.id === downloadedAlbum)));
});

test("the summed totals' read replays off the JS thread, its steps in slices, with the same totals", async () => {
  const { db } = await library();
  const reads = readConnections(async () => asyncReadClient(db));
  for (const settled of [false, true]) {
    if (settled) settle(db);
    else unsettle(db);
    for (const window of [statsWindow("month", NOW), statsWindow("all", NOW)])
      for (const withAlbums of [true, false]) {
        const read = (d: LibraryDatabase) => playedTotalsRead(d, window, withAlbums);
        const replayed = await replayRead(reads, read, () => 0);
        const stepped = await finishReplaySteps(playedTotalsSteps(replayed.value), () => 0);
        const whole = playedEntityTotals(db, window);
        assert.deepEqual(
          stepped.value,
          withAlbums ? whole : { albums: [], artists: playedArtistTotals(db, window) },
        );
        // The shared read is left as it was: a second caller's steps give the same.
        assert.deepEqual(finishSteps(playedTotalsSteps(replayed.value)), stepped.value);
      }
  }
});

test("the summed totals work out each streamed song on a step of its own", async () => {
  const db = await openTestDatabase();
  addTrack(db, { title: "Solo", artist: "A", album: "First" });
  const window = statsWindow("all", NOW);
  const streams = (from: number, count: number) => {
    for (let index = from; index < from + count; index++)
      recordPlay(
        db,
        play(`yt:v${index}`, NOW - index * 60_000),
        false,
        streamed(`v${index}`, ["A"], "First", null),
      );
  };
  streams(0, 20);
  unsettle(db);
  const before = stepsOf(db, window);
  streams(20, 20);
  unsettle(db);
  // Each new song adds its merge, its resolve and its rank, a step each, and more as it's learned.
  assert.ok(stepsOf(db, window) - before >= 20 * 3, `${stepsOf(db, window)} - ${before}`);
});

test("marking songs owed looks them up by their key, never through every settled song", async () => {
  const db = await openTestDatabase();
  const owing = (body: string) =>
    body.match(/UPDATE played_songs SET state = 1 WHERE[^;]*;/g) ?? [];
  const triggers = db.all<{ name: string; body: string }>(
    sql`SELECT name, sql AS body FROM sqlite_master WHERE type = 'trigger'`,
  );
  const statements = triggers.flatMap(({ name, body }) =>
    owing(body).map((statement) => ({ name, statement })),
  );
  assert.ok(statements.length > 20);
  for (const { name, statement } of statements) {
    const plain = statement.replace(/\b(new|old)\.\w+/g, "1").replace(/;$/, "");
    const plan = db
      .all<{ detail: string }>(sql.raw(`EXPLAIN QUERY PLAN ${plain}`))
      .map((row) => row.detail)
      .join(" | ");
    assert.doesNotMatch(plan, /played_songs_state_idx|SCAN played_songs/, `${name}: ${plan}`);
    // A song with no Library song isn't a key either: that is most streamed songs.
    if (!/song_track (=|IN)/.test(plain))
      assert.doesNotMatch(plan, /song_track_idx/, `${name}: ${plan}`);
  }
});

test("a rescan that changes no song's tags leaves the kept totals settled; a changed tag owes them", async () => {
  const db = await openTestDatabase();
  const splits = creditSplits();
  const file = (title: string, artist: string, album: string): IndexedTrack => ({
    ...normalizeTrack({ path: `/Music/${album}/${title}.mp3`, title, artist, album }),
    sizeBytes: 1_000,
    modifiedAt: 0,
    sampleRate: null,
    bitrateKbps: null,
    artworkHash: null,
    hasLyrics: false,
    explicit: "unknown",
  });
  const files = [
    file("Solo", "A", "First"),
    file("Duet", "A & B", "First"),
    file("Mix", "C", "Hits"),
  ];
  const { trackIds } = saveBatch(db, splits, files, [], [], NOW);
  removeTracks(db, splits, []);
  const online = streamed("online-1", ["D", "E"], "Online album", "MPREb_online");
  for (let index = 0; index < 40; index++) {
    const id = index % 4 === 3 ? "yt:online-1" : String(trackIds[index % 3]);
    recordPlay(db, play(id, NOW - index * DAY), false, id === "yt:online-1" ? online : undefined);
  }
  settle(db);

  // A scan saves the touched files again, tags as they were.
  saveBatch(db, splits, files, [], [], NOW + 1, { linkEntries: false });
  removeTracks(db, splits, []);
  assert.equal(keptTotalsSettled(db), true);

  saveBatch(db, splits, [file("Solo", "A", "First (Deluxe)")], [], [], NOW + 2);
  removeTracks(db, splits, []);
  assert.equal(keptTotalsSettled(db), false);
  settle(db);
  assertSameTotals(db);
});
