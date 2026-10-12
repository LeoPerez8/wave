/// <reference types="node" />
import type { PlayEvent } from "@wave/core";
import { eq } from "drizzle-orm";
import assert from "node:assert/strict";
import { beforeEach, describe, test } from "node:test";

import { recordPlay } from "./playHistory.ts";
import * as schema from "./schema.ts";
import { creditedPlayTotals, songListening, trackPlayTotals } from "./stats.ts";
import { addTrack, openTestDatabase, type TestDatabase } from "./testDatabase.ts";

/** A counted play of `trackId` that started at `startedAt`. */
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

const skip = { endReason: "skipped", listenedMs: 10_000, counted: false } as const;

let db: TestDatabase;

beforeEach(async () => {
  db = await openTestDatabase();
});

const byId = (rows: ReturnType<typeof trackPlayTotals>) => rows.toSorted((a, b) => a.id - b.id);

describe("Per-track play totals", () => {
  test("sum each track's counted plays, listened time and latest counted play", () => {
    const blue = addTrack(db, { title: "Blue in Green" });
    const so = addTrack(db, { title: "So What" });
    addTrack(db, { title: "Never played" });
    recordPlay(db, play(blue, 1_000, { listenedMs: 100_000 }));
    recordPlay(db, play(blue, 3_000, { listenedMs: 200_000 }));
    recordPlay(db, play(so, 2_000, { listenedMs: 150_000 }));

    assert.deepEqual(byId(trackPlayTotals(db, { from: null, to: 10_000 })), [
      {
        id: blue,
        sortKey: "blue in green",
        countedPlays: 2,
        listenedMs: 300_000,
        latestPlayAt: 3_000,
      },
      { id: so, sortKey: "so what", countedPlays: 1, listenedMs: 150_000, latestPlayAt: 2_000 },
    ]);
  });

  test("only counted plays count: skips add neither plays, time nor recency", () => {
    const track = addTrack(db, { title: "Sampled" });
    const never = addTrack(db, { title: "Only skipped" });
    recordPlay(db, play(track, 1_000));
    recordPlay(db, play(track, 5_000, skip));
    recordPlay(db, play(never, 2_000, skip));

    assert.deepEqual(trackPlayTotals(db, { from: null, to: 10_000 }), [
      { id: track, sortKey: "sampled", countedPlays: 1, listenedMs: 180_000, latestPlayAt: 1_000 },
    ]);
  });

  test("count plays started from the window's start up to its end, both included", () => {
    const track = addTrack(db, { title: "Edges" });
    recordPlay(db, play(track, 999));
    recordPlay(db, play(track, 1_000));
    recordPlay(db, play(track, 2_000));
    recordPlay(db, play(track, 2_001));

    const [totals] = trackPlayTotals(db, { from: 1_000, to: 2_000 });
    assert.equal(totals?.countedPlays, 2);
    assert.equal(totals?.latestPlayAt, 2_000);
  });

  test("an empty window has no totals", () => {
    const track = addTrack(db, { title: "Long ago" });
    recordPlay(db, play(track, 1_000));
    assert.deepEqual(trackPlayTotals(db, { from: 5_000, to: 10_000 }), []);
  });

  test("tracks that left the library drop out", () => {
    const gone = addTrack(db, { title: "Deleted" });
    const kept = addTrack(db, { title: "Kept" });
    recordPlay(db, play(gone, 1_000));
    recordPlay(db, play(kept, 2_000));
    db.delete(schema.tracks).where(eq(schema.tracks.id, gone)).run();

    assert.deepEqual(
      trackPlayTotals(db, { from: null, to: 10_000 }).map((row) => row.id),
      [kept],
    );
  });
});

/** The album and track artist of `trackId`. */
const creditOf = (trackId: number) => {
  const track = db.select().from(schema.tracks).where(eq(schema.tracks.id, trackId)).get();
  if (track === undefined) throw new Error(`no track ${trackId}`);
  return { albumId: track.albumId, artistId: track.artistId };
};

const byCredit = (rows: ReturnType<typeof creditedPlayTotals>) =>
  rows.toSorted((a, b) => a.albumId - b.albumId || a.artistId - b.artistId);

describe("Per-album, per-track-artist play totals", () => {
  test("sum counted plays per album and track artist, crediting a compilation's real artists", () => {
    const so = addTrack(db, { title: "So What", artist: "Miles Davis", album: "Kind of Blue" });
    const blue = addTrack(db, {
      title: "Blue in Green",
      artist: "Miles Davis",
      album: "Kind of Blue",
    });
    const milesOnHits = addTrack(db, {
      title: "Milestones",
      artist: "Miles Davis",
      album: "Jazz Hits",
      albumArtist: "Various Artists",
    });
    const trane = addTrack(db, {
      title: "Naima",
      artist: "John Coltrane",
      album: "Jazz Hits",
      albumArtist: "Various Artists",
    });
    recordPlay(db, play(so, 1_000, { listenedMs: 100_000 }));
    recordPlay(db, play(blue, 4_000, { listenedMs: 200_000 }));
    recordPlay(db, play(milesOnHits, 2_000, { listenedMs: 150_000 }));
    recordPlay(db, play(trane, 3_000, { listenedMs: 120_000 }));
    recordPlay(db, play(trane, 5_000, { listenedMs: 130_000 }));

    const kindOfBlue = creditOf(so);
    const hitsMiles = creditOf(milesOnHits);
    const hitsTrane = creditOf(trane);
    assert.equal(hitsMiles.artistId, kindOfBlue.artistId);

    assert.deepEqual(
      byCredit(creditedPlayTotals(db, { from: null, to: 10_000 })),
      byCredit([
        {
          ...kindOfBlue,
          albumSort: "kind of blue",
          artistSort: "miles davis",
          countedPlays: 2,
          listenedMs: 300_000,
          latestPlayAt: 4_000,
        },
        {
          ...hitsMiles,
          albumSort: "jazz hits",
          artistSort: "miles davis",
          countedPlays: 1,
          listenedMs: 150_000,
          latestPlayAt: 2_000,
        },
        {
          ...hitsTrane,
          albumSort: "jazz hits",
          artistSort: "john coltrane",
          countedPlays: 2,
          listenedMs: 250_000,
          latestPlayAt: 5_000,
        },
      ]),
    );
  });

  test("only counted plays within the window count, both ends included", () => {
    const track = addTrack(db, { title: "Edges", artist: "Edgar", album: "Bounds" });
    const skipped = addTrack(db, { title: "Skipped", artist: "Skipper", album: "Skips" });
    recordPlay(db, play(track, 999));
    recordPlay(db, play(track, 1_000));
    recordPlay(db, play(track, 1_500, skip));
    recordPlay(db, play(track, 2_000));
    recordPlay(db, play(track, 2_001));
    recordPlay(db, play(skipped, 1_500, skip));

    const rows = creditedPlayTotals(db, { from: 1_000, to: 2_000 });
    assert.deepEqual(
      rows.map((row) => [row.albumSort, row.countedPlays, row.latestPlayAt]),
      [["bounds", 2, 2_000]],
    );
    assert.deepEqual(creditedPlayTotals(db, { from: 5_000, to: 10_000 }), []);
  });

  test("tracks that left the library drop out", () => {
    const gone = addTrack(db, { title: "Deleted", artist: "Ghost", album: "Gone" });
    const kept = addTrack(db, { title: "Kept", artist: "Keeper", album: "Here" });
    recordPlay(db, play(gone, 1_000));
    recordPlay(db, play(kept, 2_000));
    db.delete(schema.tracks).where(eq(schema.tracks.id, gone)).run();

    assert.deepEqual(
      creditedPlayTotals(db, { from: null, to: 10_000 }).map((row) => row.artistSort),
      ["keeper"],
    );
  });
});

const byTrack = (rows: ReturnType<typeof songListening>) =>
  rows.toSorted((a, b) => a.trackId - b.trackId);

describe("Per-song listening over all time", () => {
  test("sum every play's time, the counted plays and the latest play, with the track artist", () => {
    const so = addTrack(db, { title: "So What", artist: "Miles Davis" });
    const naima = addTrack(db, { title: "Naima", artist: "John Coltrane" });
    addTrack(db, { title: "Never played" });
    recordPlay(db, play(so, 1_000, { listenedMs: 100_000 }));
    recordPlay(db, play(so, 3_000, skip));
    recordPlay(db, play(naima, 2_000, skip));

    assert.deepEqual(byTrack(songListening(db)), [
      {
        trackId: so,
        artistId: creditOf(so).artistId,
        countedPlays: 1,
        listenedMs: 110_000,
        lastPlayedAt: 3_000,
      },
      {
        trackId: naima,
        artistId: creditOf(naima).artistId,
        countedPlays: 0,
        listenedMs: 10_000,
        lastPlayedAt: 2_000,
      },
    ]);
  });

  test("a song that left the library keeps its history, without an artist", () => {
    const gone = addTrack(db, { title: "Deleted" });
    recordPlay(db, play(gone, 1_000));
    recordPlay(db, play(gone, 2_000));
    db.delete(schema.tracks).where(eq(schema.tracks.id, gone)).run();

    assert.deepEqual(songListening(db), [
      { trackId: gone, artistId: null, countedPlays: 2, listenedMs: 360_000, lastPlayedAt: 2_000 },
    ]);
  });
});
