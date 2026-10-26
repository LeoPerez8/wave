import assert from "node:assert/strict";
import { test } from "node:test";
import { eq, sql } from "drizzle-orm";
import type { PlayEvent } from "@wave/core";

import { listeningHistory } from "./listeningHistory.ts";
import { recordPlay, updatePlay } from "./playHistory.ts";
import * as schema from "./schema.ts";
import { addTrack, migrateTestDatabase, openTestDatabase, traceQueries } from "./testDatabase.ts";
import { deleteTracksById } from "./tracks.ts";

const play = (trackId: number, startedAt: number, counted = true): PlayEvent => ({
  trackId: String(trackId),
  startedAt,
  counted,
  listenedMs: counted ? 20_000 : 0,
  durationMs: 180_000,
  endReason: "interrupted",
  context: null,
  source: "phone",
});

test("history pages counted plays with stable ties, excluding skips and imported dates", async () => {
  const db = await openTestDatabase();
  const track = addTrack(db, { title: "Airbag" });
  db.run(sql`WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x + 1 FROM n WHERE x < 10000)
    INSERT INTO play_events (track_id, started_at, listened_ms, counted, end_reason)
    SELECT ${track}, x / 3, 20000, 1, 'stopped' FROM n`);
  recordPlay(db, play(track, 20_000, false));
  const imported = recordPlay(db, play(track, 30_000));
  db.update(schema.playEvents)
    .set({ importedFrom: "blackplayer" })
    .where(eq(schema.playEvents.id, imported))
    .run();
  const current = recordPlay(db, play(track, 40_000));
  const { result: first, queries } = traceQueries(db, () => listeningHistory(db));
  assert.equal(first.rows.length, 50);
  assert.equal(first.rows[0]?.id, current);
  assert.ok(queries.every(({ rows }) => rows <= 51));
  assert.ok(
    queries.some(({ plan }) => plan.some((step) => step.includes("play_events_history_idx"))),
  );
  const ids = first.rows.map(({ id }) => id);
  let cursor = first.next;
  while (cursor !== null) {
    const page = listeningHistory(db, cursor);
    ids.push(...page.rows.map(({ id }) => id));
    cursor = page.next;
  }
  assert.deepEqual(ids, [current, ...Array.from({ length: 10_000 }, (_, i) => 10_000 - i)]);
});

test("a counted play keeps its start-time metadata after retagging and removing its song", async () => {
  const db = await openTestDatabase();
  const track = addTrack(db, {
    title: "Airbag",
    artist: "Radiohead",
    album: "OK Computer",
    artworkHash: "ok",
  });
  const id = recordPlay(db, play(track, 1000, false));
  assert.equal(listeningHistory(db).rows.length, 0);
  db.update(schema.tracks)
    .set({ title: "Retagged", artistCredit: "Changed" })
    .where(eq(schema.tracks.id, track))
    .run();
  updatePlay(db, id, play(track, 1000));
  const before = listeningHistory(db).rows[0]!;
  assert.equal(before.song?.title, "Retagged");
  assert.deepEqual(before.snapshot, {
    title: "Airbag",
    artist: "Radiohead",
    album: "OK Computer",
    artworkPath: "/covers/ok.jpg",
    thumbPath: "/covers/ok.thumb.jpg",
  });
  deleteTracksById(db, [track]);
  db.delete(schema.albums).run();
  db.delete(schema.artists).run();
  db.delete(schema.artwork).run();
  const after = listeningHistory(db).rows[0]!;
  assert.deepEqual(after.snapshot, before.snapshot);
  assert.equal(after.song, null);
});

test("upgrading fills Library, account, retained Stats and unknown snapshots in that order", async () => {
  const db = await openTestDatabase({ through: "0038_genre_order" });
  const library = addTrack(db, {
    title: "Library title",
    artist: "Library artist",
    album: "Library album",
    artworkHash: "library",
  });
  const account = addTrack(db, {
    title: "Gone title",
    artist: "Gone artist",
    album: "Gone album",
    artworkHash: "gone",
  });
  const stats = addTrack(db, {
    title: "Also gone",
    artist: "First, Second",
    album: "Retained album",
    artworkHash: "stats",
  });
  for (const track of [library, account, stats, 999]) {
    db.run(sql`INSERT INTO play_events (track_id, started_at, listened_ms, end_reason, counted, recording_key)
      VALUES (${track}, ${track}, 20000, 'stopped', 1, ${`key-${track}`})`);
  }
  for (const track of [library, account]) {
    db.insert(schema.accountSongs)
      .values({
        recordingKey: `key-${track}`,
        song: JSON.stringify({
          title: "Account title",
          credit: "Account artist",
          album: "Account album",
        }),
        changedAt: 1,
        phoneId: "phone",
      })
      .run();
  }
  deleteTracksById(db, [account, stats]);
  await migrateTestDatabase(db);
  const snapshots = listeningHistory(db).rows.map(({ snapshot }) => snapshot);
  assert.deepEqual(snapshots, [
    { title: "Unknown song", artist: "", album: null, artworkPath: null, thumbPath: null },
    {
      title: "Unknown song",
      artist: "First, Second",
      album: "Retained album",
      artworkPath: "/covers/stats.jpg",
      thumbPath: "/covers/stats.thumb.jpg",
    },
    {
      title: "Account title",
      artist: "Account artist",
      album: "Account album",
      artworkPath: "/covers/gone.jpg",
      thumbPath: "/covers/gone.thumb.jpg",
    },
    {
      title: "Library title",
      artist: "Library artist",
      album: "Library album",
      artworkPath: "/covers/library.jpg",
      thumbPath: "/covers/library.thumb.jpg",
    },
  ]);
});
