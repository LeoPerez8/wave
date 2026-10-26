/// <reference types="node" />
import {
  EMPTY_SYNC_TABLES,
  listeningTotals,
  statsWindow,
  summedListeningTotals,
  type CreditedPlayTotals,
  type PlayEvent,
  type SyncPlayRow,
} from "@wave/core";
import { eq, sql } from "drizzle-orm";
import assert from "node:assert/strict";
import { beforeEach, describe, test } from "node:test";

import { saveImportedPlays } from "./blackPlayer.ts";
import { creditSplits, relinkCredits } from "./credits.ts";
import { endPlay, homeSections, recordPlay, updatePlay } from "./playHistory.ts";
import {
  listeningSums,
  playTotalsDrift,
  rebuildPlayTotals,
  selectCountedPlays,
} from "./playTotals.ts";
import * as schema from "./schema.ts";
import { creditedPlayTotals, songListening, trackPlayTotals } from "./stats.ts";
import { applyPending, applyPulledPage } from "./syncRows.ts";
import {
  addTrack,
  migrateTestDatabase,
  openTestDatabase,
  traceQueries,
  type TestDatabase,
} from "./testDatabase.ts";
import { deleteTracksById } from "./tracks.ts";

/** A counted play of three minutes of `trackId`, started at `startedAt`. */
const play = (
  trackId: number,
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

/** A play as the player records it: started, brought up to date, then ended. */
const playThrough = (db: TestDatabase, done: PlayEvent): void => {
  const id = recordPlay(db, { ...done, listenedMs: 0, endReason: "stopped", counted: false });
  updatePlay(db, id, { ...done, listenedMs: Math.min(done.listenedMs, 5_000), counted: false });
  endPlay(db, id, done);
};

let db: TestDatabase;

beforeEach(async () => {
  db = await openTestDatabase();
});

describe("Listening sums", () => {
  test("sum the whole history: every play's time, counted plays, songs still in the library", () => {
    const often = addTrack(db, { title: "Often" });
    const skipped = addTrack(db, { title: "Skipped" });
    const gone = addTrack(db, { title: "Gone" });
    playThrough(db, play(often, 1_000));
    playThrough(db, play(often, 2_000, { listenedMs: 20_000, endReason: "skipped" }));
    playThrough(
      db,
      play(skipped, 3_000, { listenedMs: 10_000, endReason: "skipped", counted: false }),
    );
    playThrough(db, play(gone, 4_000, { listenedMs: 120_000 }));
    deleteTracksById(db, [gone]);

    assert.deepEqual(listeningSums(db), {
      listenedMs: 180_000 + 20_000 + 10_000 + 120_000,
      countedPlays: 3,
      songsListened: 1,
      lastPlayedAt: 4_000,
    });
  });

  test("with nothing played, nothing is summed", () => {
    addTrack(db, { title: "Unplayed" });

    assert.deepEqual(listeningSums(db), {
      listenedMs: 0,
      countedPlays: 0,
      songsListened: 0,
      lastPlayedAt: null,
    });
  });
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

/** A play another phone recorded, as a pull brings it. */
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

const pull = (plays: readonly SyncPlayRow[]): void => {
  applyPulledPage(db, { ...EMPTY_SYNC_TABLES, plays, cursor: "c", more: false }, trackIds(), 0);
};

describe("Play totals", () => {
  test("stay equal to the history whatever writes it", () => {
    const first = addTrack(db, { title: "First", durationMs: 200_000 });
    const second = addTrack(db, { title: "Second" });
    const third = addTrack(db, { title: "Third" });
    // A crossfade: the outgoing play goes on, then ends after the next one started.
    const outgoing = recordPlay(db, play(first, 1_000, { listenedMs: 0, counted: false }));
    const incoming = recordPlay(db, play(second, 2_000, { listenedMs: 0, counted: false }), true);
    updatePlay(db, outgoing, play(first, 1_000, { listenedMs: 16_000 }));
    endPlay(db, outgoing, play(first, 1_000, { listenedMs: 17_000 }));
    endPlay(
      db,
      incoming,
      play(second, 2_000, { listenedMs: 3_000, counted: false, endReason: "skipped" }),
    );
    // BlackPlayer's stats, then plays from another phone.
    saveImportedPlays(db, [
      { trackId: first, startedAt: 500 },
      { trackId: third, startedAt: 600 },
    ]);
    const keys = [...trackIds().keys()];
    pull([pulledPlay("p1", keys[1]!, 3_000), pulledPlay("p2", "not-here-yet", 4_000)]);
    // Edits no writer makes today: moved to another song, uncounted, started earlier, deleted.
    const { playEvents } = schema;
    db.update(playEvents).set({ trackId: third }).where(eq(playEvents.startedAt, 3_000)).run();
    db.update(playEvents).set({ counted: false }).where(eq(playEvents.startedAt, 600)).run();
    db.update(playEvents).set({ startedAt: 100 }).where(eq(playEvents.startedAt, 1_000)).run();
    db.delete(playEvents).where(eq(playEvents.startedAt, 2_000)).run();
    // The song leaves; its plays keep its album.
    deleteTracksById(db, [first]);

    assert.deepEqual(playTotalsDrift(db), []);
  });

  test("count a play pulled again once, and a waiting play once it is applied", () => {
    addTrack(db, { title: "Song" });
    const key = [...trackIds().keys()][0]!;
    pull([pulledPlay("p1", key, 1_000), pulledPlay("p2", key, 2_000)]);
    pull([pulledPlay("p1", key, 1_000), pulledPlay("p2", key, 2_000)]);
    pull([pulledPlay("p3", "not-here-yet", 3_000)]);
    addTrack(db, { title: "Later" });
    db.update(schema.tracks)
      .set({ recordingKey: "not-here-yet" })
      .where(eq(schema.tracks.title, "Later"))
      .run();
    applyPending(db, trackIds());
    applyPending(db, trackIds());

    assert.equal(listeningSums(db).countedPlays, 3);
    assert.deepEqual(playTotalsDrift(db), []);
  });

  test("an update sums the history it finds, then keeps up with new plays", async () => {
    const before = await openTestDatabase({ through: "0022_playlist_revisions" });
    const kept = addTrack(before, { title: "Kept" });
    const gone = addTrack(before, { title: "Gone" });
    // Seed what that app version wrote, before playback snapshots existed.
    for (const event of [
      play(kept, 1_000),
      play(kept, 2_000, { listenedMs: 5_000, counted: false }),
      play(gone, 3_000),
    ])
      before.run(sql`INSERT INTO play_events (track_id, started_at, listened_ms, duration_ms, end_reason, counted)
        VALUES (${Number(event.trackId)}, ${event.startedAt}, ${event.listenedMs}, ${event.durationMs}, ${event.endReason}, ${event.counted})`);
    deleteTracksById(before, [gone]);

    await migrateTestDatabase(before);

    assert.deepEqual(playTotalsDrift(before), []);
    assert.deepEqual(listeningSums(before), {
      listenedMs: 180_000 + 5_000 + 180_000,
      countedPlays: 2,
      songsListened: 1,
      lastPlayedAt: 3_000,
    });
    playThrough(before, play(kept, 4_000));
    assert.equal(listeningSums(before).countedPlays, 3);
    assert.deepEqual(playTotalsDrift(before), []);
  });

  test("can be summed again from the history when they drift", () => {
    const song = addTrack(db, { title: "Song" });
    playThrough(db, play(song, 1_000));
    playThrough(db, play(song, 2_000));
    db.run(sql`UPDATE play_totals SET counted_plays = 7`);

    assert.deepEqual(playTotalsDrift(db), [song]);
    rebuildPlayTotals(db);
    assert.deepEqual(playTotalsDrift(db), []);
    assert.equal(listeningSums(db).countedPlays, 2);
  });
});

/** A pseudo-random sequence in [0, 1) (mulberry32), the same every run. */
const randomFrom = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
};

/** When Home is read: after every play but one, stamped later by another phone's clock. */
const NOW = 1_000_000;

/**
 * A history with what Home's totals must get right: 60 songs on 20 albums,
 * collaborations, a missing song (no file), 500 plays at distinct times
 * (skips, short plays, plays counted only once listened to enough),
 * BlackPlayer's plays, songs deleted after their plays, and a play stamped
 * after now.
 */
const seedHistory = (): number[] => {
  const songs = Array.from({ length: 60 }, (_, i) =>
    addTrack(db, {
      title: `Song ${i}`,
      album: `Album ${i % 20}`,
      artist: i % 7 === 0 ? "Ana, Bo" : `Artist ${i % 4}`,
    }),
  );
  db.update(schema.tracks).set({ path: null }).where(eq(schema.tracks.id, songs[5]!)).run();
  relinkCredits(db, creditSplits());
  const next = randomFrom(312);
  for (let i = 0; i < 500; i++) {
    const song = songs[Math.floor(next() * songs.length)]!;
    const listenedMs = Math.floor(next() * 200_000);
    const counted = listenedMs > 15_000;
    playThrough(
      db,
      play(song, 10_000 + i * 1_000, {
        listenedMs,
        counted,
        endReason: counted ? "completed" : "skipped",
      }),
    );
  }
  saveImportedPlays(
    db,
    songs.slice(0, 8).map((trackId, i) => ({ trackId, startedAt: 5_000 + i })),
  );
  playThrough(db, play(songs[3]!, NOW + 50_000));
  deleteTracksById(db, [songs[1]!, songs[7]!, songs[14]!]);
  return songs;
};

/** Credited totals in one order, to compare reads that return them in none. */
const byCredit = (rows: readonly CreditedPlayTotals[]) =>
  rows.toSorted(
    (a, b) =>
      a.albumId - b.albumId || a.artistId - b.artistId || Number(a.primary) - Number(b.primary),
  );

/** Home's Most Played from the whole history: every counted play of each song in [scope]. */
const mostPlayedFromHistory = (scope: "library" | "files") => {
  const inScope = new Set(
    db
      .select({ id: schema.tracks.id, path: schema.tracks.path })
      .from(schema.tracks)
      .all()
      .filter((track) => scope === "library" || track.path !== null)
      .map((track) => track.id),
  );
  return trackPlayTotals(db, { from: Number.MIN_SAFE_INTEGER, to: Number.MAX_SAFE_INTEGER })
    .filter((song) => inScope.has(song.id))
    .toSorted(
      (a, b) => b.countedPlays - a.countedPlays || b.latestPlayAt - a.latestPlayAt || b.id - a.id,
    )
    .slice(0, 10)
    .map((song) => [song.id, song.countedPlays]);
};

/** Home's Recently Played from the whole history: albums of the songs in the library by their latest play. */
const recentlyPlayedFromHistory = () => {
  const albumOf = new Map(
    db
      .select({ id: schema.tracks.id, albumId: schema.tracks.albumId })
      .from(schema.tracks)
      .all()
      .map((track) => [track.id, track.albumId]),
  );
  const latest = new Map<number, number>();
  for (const { trackId, startedAt } of db.select().from(schema.playEvents).all()) {
    const albumId = albumOf.get(trackId);
    if (albumId === undefined) continue;
    latest.set(albumId, Math.max(latest.get(albumId) ?? startedAt, startedAt));
  }
  return [...latest]
    .toSorted(([, a], [, b]) => b - a)
    .slice(0, 12)
    .map(([albumId]) => albumId);
};

describe("Home's all-time reads", () => {
  test("agree with the whole history", () => {
    seedHistory();

    const home = homeSections(db);
    assert.deepEqual(
      home.mostPlayed.map((song) => [song.id, song.playCount]),
      mostPlayedFromHistory("library"),
    );
    assert.deepEqual(
      homeSections(db, "files").mostPlayed.map((song) => [song.id, song.playCount]),
      mostPlayedFromHistory("files"),
    );
    assert.deepEqual(
      home.recentlyPlayed.map((album) => album.id),
      recentlyPlayedFromHistory(),
    );
    assert.deepEqual(
      byCredit(creditedPlayTotals(db, statsWindow("all", NOW))),
      byCredit(creditedPlayTotals(db, { from: Number.MIN_SAFE_INTEGER, to: NOW })),
    );
    assert.deepEqual(summedListeningTotals(listeningSums(db)), listeningTotals(songListening(db)));
  });

  test("read the totals, never the play history", () => {
    seedHistory();

    for (const read of [
      (): unknown => homeSections(db),
      () => homeSections(db, "files"),
      () => listeningSums(db),
      () => creditedPlayTotals(db, statsWindow("all", NOW)),
    ]) {
      for (const query of traceQueries(db, read).queries) {
        assert.deepEqual(
          query.plan.filter((step) => /\bSCAN play_events\b/.test(step)),
          [],
          query.sql,
        );
      }
    }
  });

  test("walk the totals in order for Most Played and Recently Played, stopping early", () => {
    seedHistory();

    const plans = traceQueries(db, () => homeSections(db))
      .queries.filter((query) => query.sql.includes("play_totals"))
      .map((query) => query.plan.join("; "));
    assert.equal(plans.length >= 2, true, plans.join("\n"));
    for (const plan of plans) {
      assert.match(
        plan,
        /(SCAN|SEARCH) play_totals USING (COVERING )?INDEX play_totals_(counted|last_played)_idx/,
      );
      assert.doesNotMatch(plan, /TEMP B-TREE/);
    }
  });
});

describe("selectCountedPlays", () => {
  test("gives each song's counted plays, leaving out those never counted", () => {
    const often = addTrack(db, { title: "Often" });
    const skipped = addTrack(db, { title: "Skipped" });
    const never = addTrack(db, { title: "Never" });
    playThrough(db, play(often, 1_000));
    playThrough(db, play(often, 2_000));
    playThrough(db, play(skipped, 3_000, { counted: false, listenedMs: 4_000 }));
    assert.deepEqual(selectCountedPlays(db, [often, skipped, never]), new Map([[often, 2]]));
  });
});
