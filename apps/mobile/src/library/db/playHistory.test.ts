/// <reference types="node" />
import { isCountedPlay, type PlayEvent } from "@wave/core";
import { eq, sql } from "drizzle-orm";
import assert from "node:assert/strict";
import { beforeEach, describe, test } from "node:test";

import { libraryCounts, sectionSongCounts } from "./counts.ts";
import {
  homeSections,
  latestPlay,
  listFavorites,
  recordPlay,
  selectFavoriteTrackIds,
  setFavorites,
  updatePlay,
} from "./playHistory.ts";
import * as schema from "./schema.ts";
import { trackPlayTotals } from "./stats.ts";
import { selectChangesSince, selectPhoneId } from "./sync.ts";
import {
  addTrack,
  migrateTestDatabase,
  openTestDatabase,
  star,
  type TestDatabase,
} from "./testDatabase.ts";

const album = { kind: "album", id: "1" } as const;

/** A play of `trackId` that started at `startedAt`. */
const play = (
  trackId: number,
  startedAt: number,
  overrides: Partial<PlayEvent> = {},
): PlayEvent => ({
  trackId: String(trackId),
  context: album,
  startedAt,
  listenedMs: 180_000,
  durationMs: 180_000,
  endReason: "completed",
  counted: true,
  source: "phone",
  ...overrides,
});

let db: TestDatabase;

beforeEach(async () => {
  db = await openTestDatabase();
});

describe("Recently Added", () => {
  test("lists albums by when their newest song entered the library, newest first", () => {
    addTrack(db, { title: "Old 1", album: "Old", addedAt: 1_000 });
    addTrack(db, { title: "Newer", album: "Newer", addedAt: 2_000 });
    // A song added later to an older album brings the album forward.
    addTrack(db, { title: "Old 2", album: "Old", addedAt: 3_000 });

    const added = homeSections(db).recentlyAdded;
    assert.deepEqual(
      added.map((row) => [row.title, row.trackCount]),
      [
        ["Old", 2],
        ["Newer", 1],
      ],
    );
  });
});

describe("History of removed files", () => {
  test("a played track can leave the library, and Home stops listing it", () => {
    const gone = addTrack(db, { title: "Deleted", album: "Gone" });
    const kept = addTrack(db, { title: "Kept", album: "Here" });
    recordPlay(db, play(gone, 1_000));
    recordPlay(db, play(kept, 2_000));

    db.delete(schema.tracks).where(eq(schema.tracks.id, gone)).run();

    const home = homeSections(db);
    assert.deepEqual(
      home.recentlyPlayed.map((row) => row.title),
      ["Here"],
    );
    assert.deepEqual(
      home.mostPlayed.map((row) => row.title),
      ["Kept"],
    );
  });
});

describe("Favorites", () => {
  test("lists starred songs, the most recently starred first", () => {
    const early = addTrack(db, { title: "Starred early" });
    const late = addTrack(db, { title: "Starred late" });
    addTrack(db, { title: "Not starred" });
    star(db, early, 1_000);
    star(db, late, 2_000);

    assert.deepEqual(
      homeSections(db).favorites.map((row) => row.title),
      ["Starred late", "Starred early"],
    );
  });

  test("the Favorites list carries when each song was starred, for sorting by it", () => {
    const early = addTrack(db, { title: "Starred early" });
    const late = addTrack(db, { title: "Starred late" });
    addTrack(db, { title: "Not starred" });
    star(db, early, 1_000);
    star(db, late, 2_000);

    assert.deepEqual(
      listFavorites(db).map((row) => [row.title, row.starredAt]),
      [
        ["Starred late", 2_000],
        ["Starred early", 1_000],
      ],
    );
  });

  test("stars many songs at once; songs starred already keep when they were starred", () => {
    const old = addTrack(db, { title: "Starred before" });
    const a = addTrack(db, { title: "Airbag" });
    const b = addTrack(db, { title: "Bloom" });
    star(db, old, 1_000);

    setFavorites(db, [a, old, b], true, 5_000);

    assert.deepEqual(
      listFavorites(db).map((row) => [row.title, row.starredAt]),
      [
        ["Airbag", 5_000],
        ["Bloom", 5_000],
        ["Starred before", 1_000],
      ],
    );
  });

  test("unstars many songs at once", () => {
    const a = addTrack(db, { title: "Airbag" });
    const b = addTrack(db, { title: "Bloom" });
    const c = addTrack(db, { title: "Creep" });
    for (const id of [a, b, c]) star(db, id, 1_000);

    setFavorites(db, [a, c], false, 5_000);

    assert.deepEqual(
      listFavorites(db).map((row) => row.title),
      ["Bloom"],
    );
  });

  test("an unstarred song's star stays as a tombstone, stamped by this phone, that nothing shows", () => {
    const a = addTrack(db, { title: "Airbag" });
    const b = addTrack(db, { title: "Bloom" });
    for (const id of [a, b]) star(db, id, 1_000);

    setFavorites(db, [a], false, 5_000);

    assert.deepEqual(
      selectChangesSince(db, 1_000).favorites.map((row) => [
        row.trackId,
        row.changedAt,
        row.phoneId,
        row.deleted,
      ]),
      [[a, 5_000, selectPhoneId(db), true]],
    );
    assert.deepEqual(selectFavoriteTrackIds(db), [b]);
    assert.deepEqual(
      homeSections(db).favorites.map((row) => row.title),
      ["Bloom"],
    );
    assert.equal(libraryCounts(db).favorites, 1);
    assert.equal(sectionSongCounts(db).favorites, 1);
  });

  test("starring a song again brings its star back, starred now", () => {
    const a = addTrack(db, { title: "Airbag" });
    star(db, a, 1_000);
    setFavorites(db, [a], false, 5_000);
    // In the same millisecond: the star's changes still get two times.
    setFavorites(db, [a], true, 5_000);

    assert.deepEqual(
      listFavorites(db).map((row) => [row.title, row.starredAt]),
      [["Airbag", 5_000]],
    );
    assert.deepEqual(
      selectChangesSince(db, 0).favorites.map((row) => [row.changedAt, row.deleted]),
      [[5_001, false]],
    );
  });

  test("starring a starred song changes nothing", () => {
    const a = addTrack(db, { title: "Airbag" });
    star(db, a, 1_000);
    setFavorites(db, [a], true, 5_000);
    assert.deepEqual(selectChangesSince(db, 1_000).favorites, []);
  });
});

describe("Recently Played", () => {
  test("lists the albums of the tracks played, the latest first", () => {
    const blue = addTrack(db, { title: "Blue in Green", album: "Kind of Blue" });
    const so = addTrack(db, { title: "So What", album: "Kind of Blue" });
    const koln = addTrack(db, { title: "Part I", album: "The Köln Concert" });
    addTrack(db, { title: "Never played", album: "Silent" });

    recordPlay(db, play(blue, 1_000));
    recordPlay(db, play(koln, 2_000));
    recordPlay(db, play(so, 3_000));

    assert.deepEqual(
      homeSections(db).recentlyPlayed.map((row) => row.title),
      ["Kind of Blue", "The Köln Concert"],
    );
  });
});

describe("Most Played", () => {
  test("ranks tracks by counted plays only; skips and short plays don't count", () => {
    const often = addTrack(db, { title: "Often" });
    const skipped = addTrack(db, { title: "Skipped a lot" });
    const never = addTrack(db, { title: "Only sampled" });
    const skip = { endReason: "skipped", listenedMs: 10_000, counted: false } as const;

    let at = 0;
    for (let i = 0; i < 3; i += 1) recordPlay(db, play(often, (at += 1)));
    for (let i = 0; i < 2; i += 1) recordPlay(db, play(skipped, (at += 1)));
    for (let i = 0; i < 5; i += 1) recordPlay(db, play(skipped, (at += 1), skip));
    recordPlay(db, play(never, (at += 1), skip));

    assert.deepEqual(
      homeSections(db).mostPlayed.map((row) => [row.title, row.playCount]),
      [
        ["Often", 3],
        ["Skipped a lot", 2],
      ],
    );
  });

  test("a play recorded as it starts counts once it has been listened to enough", () => {
    const track = addTrack(db, { title: "Growing" });
    const id = recordPlay(
      db,
      play(track, 1_000, { listenedMs: 0, endReason: "interrupted", counted: false }),
    );
    assert.deepEqual(homeSections(db).mostPlayed, []);

    updatePlay(db, id, play(track, 1_000, { listenedMs: 95_000, endReason: "completed" }));
    updatePlay(db, id, play(track, 1_000, { listenedMs: 180_000, endReason: "completed" }));
    assert.deepEqual(
      homeSections(db).mostPlayed.map((row) => [row.title, row.playCount]),
      [["Growing", 1]],
    );
  });

  test("breaks ties by the most recent counted play", () => {
    const first = addTrack(db, { title: "First" });
    const second = addTrack(db, { title: "Second" });
    recordPlay(db, play(first, 1_000));
    recordPlay(db, play(second, 2_000));

    assert.deepEqual(
      homeSections(db).mostPlayed.map((row) => row.title),
      ["Second", "First"],
    );
  });
});

describe("The latest play", () => {
  test("is the play recorded last, as last brought up to date, to pick it back up", () => {
    const first = addTrack(db, { title: "First" });
    const second = addTrack(db, { title: "Second" });
    recordPlay(db, play(first, 1_000));
    const going = { listenedMs: 0, endReason: "interrupted", counted: false } as const;
    const id = recordPlay(db, play(second, 200_000, going));
    updatePlay(db, id, play(second, 200_000, { ...going, listenedMs: 45_000 }));

    assert.deepEqual(latestPlay(db), {
      id,
      play: play(second, 200_000, { ...going, listenedMs: 45_000 }),
    });
  });

  test("a play outside any context comes back without one", () => {
    const track = addTrack(db, { title: "Queued" });
    const id = recordPlay(db, play(track, 1_000, { context: null }));
    assert.deepEqual(latestPlay(db), { id, play: play(track, 1_000, { context: null }) });
  });

  test("plays started from a folder, before Folders left the Library, still load and count", () => {
    const track = addTrack(db, { title: "From a folder", album: "Rock" });
    const folder = { kind: "folder", id: "3" } as const;
    recordPlay(db, play(track, 1_000, { context: folder }));
    const id = recordPlay(db, play(track, 2_000, { context: folder }));

    assert.deepEqual(latestPlay(db), { id, play: play(track, 2_000, { context: folder }) });
    assert.deepEqual(
      homeSections(db).mostPlayed.map((row) => [row.title, row.playCount]),
      [["From a folder", 2]],
    );
  });

  test("there is none before anything was played", () => {
    assert.equal(latestPlay(db), null);
  });
});

describe("Play source", () => {
  test("a play is recorded with where it was started from", () => {
    const track = addTrack(db, { title: "In the car" });
    const id = recordPlay(db, play(track, 1_000, { source: "auto" }));
    updatePlay(db, id, play(track, 1_000, { source: "auto", listenedMs: 200_000 }));

    assert.equal(latestPlay(db)?.play.source, "auto");
  });

  test("plays recorded before v2 become phone plays, and Home reads them as before", async () => {
    const v1 = await openTestDatabase({ through: "0005_play_events" });
    const often = addTrack(v1, { title: "Often", album: "First" });
    const once = addTrack(v1, { title: "Once", album: "Second" });
    // Rows as v1 wrote them, with no play source.
    const v1Play = (trackId: number, startedAt: number) =>
      v1.run(
        sql`INSERT INTO play_events (track_id, started_at, listened_ms, duration_ms, end_reason, counted, context_type, context_id)
              VALUES (${trackId}, ${startedAt}, 180000, 180000, 'completed', 1, 'album', '1')`,
      );
    v1Play(often, 1_000);
    v1Play(often, 2_000);
    v1Play(once, 3_000);
    const allTime = { from: null, to: 10_000 };
    const totalsBefore = trackPlayTotals(v1, allTime);

    await migrateTestDatabase(v1);

    assert.deepEqual(
      v1.select({ source: schema.playEvents.source }).from(schema.playEvents).all(),
      [{ source: "phone" }, { source: "phone" }, { source: "phone" }],
    );
    // Home reads today's columns, so it's read after the upgrade only.
    const home = homeSections(v1);
    assert.deepEqual(trackPlayTotals(v1, allTime), totalsBefore);
    assert.deepEqual(
      home.recentlyPlayed.map((played) => played.title),
      ["Second", "First"],
    );
    assert.deepEqual(
      home.mostPlayed.map((row) => [row.title, row.playCount]),
      [
        ["Often", 2],
        ["Once", 1],
      ],
    );

    const id = recordPlay(v1, play(once, 4_000, { source: "auto" }));
    assert.deepEqual(latestPlay(v1), { id, play: play(once, 4_000, { source: "auto" }) });
  });
});

describe("Recounting past plays", () => {
  test("plays on record are recounted: more than 15 s, or a short song played through", async () => {
    const v2 = await openTestDatabase({ through: "0006_play_source" });
    const song = addTrack(v2, { title: "Song", album: "First", durationMs: 180_000 });
    const jingle = addTrack(v2, { title: "Jingle", album: "Second", durationMs: 10_000 });
    // Rows as v2 wrote them: counted under "half the track or four minutes".
    const v2Play = (
      trackId: number,
      startedAt: number,
      listenedMs: number,
      durationMs: number | null,
      endReason: PlayEvent["endReason"],
      counted: boolean,
    ) =>
      v2.run(
        sql`INSERT INTO play_events (track_id, started_at, listened_ms, duration_ms, end_reason, counted)
              VALUES (${trackId}, ${startedAt}, ${listenedMs}, ${durationMs}, ${endReason}, ${counted ? 1 : 0})`,
      );
    v2Play(song, 1_000, 20_000, 180_000, "skipped", false); // now counted
    v2Play(song, 2_000, 15_000, 180_000, "stopped", false); // 15 s exactly: not counted
    v2Play(song, 3_000, 10_000, 180_000, "completed", false); // seeked to the end: not counted
    v2Play(song, 4_000, 20_000, null, "interrupted", false); // length unknown: now counted
    v2Play(jingle, 5_000, 10_000, 10_000, "completed", true); // played through: still counted
    v2Play(jingle, 6_000, 7_000, 10_000, "skipped", true); // skipped before the end: no longer
    v2Play(jingle, 7_000, 0, 10_000, "completed", false); // never listened: not counted

    await migrateTestDatabase(v2);

    const rows = v2.select().from(schema.playEvents).orderBy(schema.playEvents.startedAt).all();
    assert.deepEqual(
      rows.map((row) => row.counted),
      [true, false, false, true, true, false, false],
    );
    // The migration agrees with Core's rule, the one the app records plays with.
    assert.deepEqual(
      rows.map((row) => row.counted),
      rows.map((row) =>
        isCountedPlay({
          listenedMs: row.listenedMs,
          durationMs: row.durationMs,
          endReason: row.endReason as PlayEvent["endReason"],
        }),
      ),
    );
    assert.deepEqual(
      homeSections(v2).mostPlayed.map((row) => [row.title, row.playCount]),
      [
        ["Song", 2],
        ["Jingle", 1],
      ],
    );
  });
});
