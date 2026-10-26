import assert from "node:assert/strict";
import { test } from "node:test";
import { eq, sql } from "drizzle-orm";
import type { PlayEvent } from "@wave/core";

import { tasteHistory } from "./taste.ts";
import { graphPlayPage } from "./artistGraph.ts";
import { listeningHistory } from "./listeningHistory.ts";
import { endPlay, latestPlay, recordPlay, updatePlay } from "./playHistory.ts";
import * as schema from "./schema.ts";
import {
  addMissingSong,
  addTrack,
  migrateTestDatabase,
  openTestDatabase,
  traceQueries,
} from "./testDatabase.ts";
import { playedRecordingKeys } from "./playHistory.ts";
import { listeningSums, playTotalsDrift, rebuildPlayTotals } from "./playTotals.ts";
import {
  countedListening,
  countedListeningPage,
  songListening,
  trackPlayTotals,
  creditedPlayTotals,
} from "./stats.ts";
import { mixHistoryPage } from "./mixInputs.ts";
import { selectUnpushed } from "./syncRows.ts";
import { markPushed } from "./syncRows.ts";
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

test("a missing song keeps its Library identity for the usual download and menu actions", async () => {
  const db = await openTestDatabase();
  const track = addMissingSong(db, {
    title: "Missing song",
    artist: "Radiohead",
    album: "OK Computer",
  });
  recordPlay(db, play(track, 1000));
  const row = listeningHistory(db).rows[0]!;
  assert.equal(row.snapshot.title, "Missing song");
  assert.equal(row.song?.id, track);
  assert.equal(row.song?.path, null);
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

const streamedSong = {
  videoId: "history-video",
  title: "Airbag",
  artists: ["Radiohead", "Guest"],
  album: "OK Computer",
  durationMs: 180_000,
  artworkUrl: "https://i.ytimg.com/cover.jpg",
  explicit: false,
  albumId: "MPREb_album",
};

test("a streamed play saves progress, its queue snapshot and recording identity without a Library track", async () => {
  const db = await openTestDatabase();
  const started = { ...play(1, 1000, false), trackId: "yt:history-video" };
  const id = recordPlay(db, started, false, streamedSong);
  assert.equal(listeningHistory(db).rows.length, 0);
  const counted = { ...started, listenedMs: 15_001, counted: true };
  updatePlay(db, id, counted);
  assert.equal(latestPlay(db)?.play.trackId, "yt:history-video");
  const row = listeningHistory(db).rows[0]!;
  assert.equal(row.videoId, "history-video");
  assert.equal(row.song, null);
  assert.deepEqual(row.streamedSong, streamedSong);
  assert.equal(row.snapshot.title, "Airbag");
  assert.equal(row.snapshot.artworkUrl, "https://i.ytimg.com/cover.jpg");
  // albumKey(title, first artist), then normalized song title, with no track number.
  assert.equal(row.recordingKey, "ok computer\u001fradiohead\u001fairbag");
  endPlay(db, id, { ...counted, endReason: "skipped" });
  assert.equal(latestPlay(db), null);
  assert.deepEqual(listeningHistory(db).rows[0]?.snapshot, row.snapshot);
});

test("streamed starts, progress and ends leave the Library-only consumers unchanged", async () => {
  const db = await openTestDatabase();
  const track = addTrack(db, { title: "Library song" });
  const id = recordPlay(db, play(track, 1000));
  endPlay(db, id, { ...play(track, 1000), endReason: "completed" });
  const existing = () => ({
    // Most Played, the listening totals and playlist recency count streamed plays (streamedCounts.test.ts).
    listening: songListening(db),
    songs: trackPlayTotals(db, { from: null, to: 100_000 }),
    artists: creditedPlayTotals(db, { from: 0, to: 100_000 }),
    recap: countedListening(db),
    recapPage: countedListeningPage(db, 0),
    mixes: mixHistoryPage(db, 0),
    keys: playedRecordingKeys(db),
    taste: tasteHistory(db),
    graph: graphPlayPage(db, [-Number.MAX_VALUE, 0]).rows,
  });
  const before = existing();
  const stream = {
    ...play(track, 2000, false),
    trackId: "yt:history-video",
    context: { kind: "playlist", id: "22" },
  };
  const streamedId = recordPlay(db, stream, false, streamedSong);
  assert.deepEqual(existing(), before);
  updatePlay(db, streamedId, { ...stream, counted: true, listenedMs: 20_000 });
  assert.deepEqual(existing(), before);
  endPlay(db, streamedId, { ...stream, counted: true, listenedMs: 25_000, endReason: "completed" });
  assert.deepEqual(existing(), before);
  assert.deepEqual(playTotalsDrift(db), []);
  rebuildPlayTotals(db);
  assert.deepEqual(existing(), before);
});

test("earlier streamed rows resolve to a downloaded Library file by video id, keeping their snapshots", async () => {
  const db = await openTestDatabase();
  recordPlay(db, { ...play(1, 1000), trackId: "yt:history-video" }, false, streamedSong);
  const original = listeningHistory(db).rows[0]!;
  const downloaded = addTrack(db, { title: "Airbag (retagged)" });
  db.update(schema.tracks)
    .set({ videoId: streamedSong.videoId })
    .where(eq(schema.tracks.id, downloaded))
    .run();
  const row = listeningHistory(db).rows[0]!;
  assert.equal(row.song?.id, downloaded);
  assert.ok(row.song?.path);
  assert.deepEqual(row.snapshot, original.snapshot);
  // Downloaded, its streamed play is the Library song's.
  assert.equal(listeningSums(db).countedPlays, 1);
  assert.equal(listeningSums(db).songsListened, 1);
});

test("upgrading preserves Library history, ids, snapshots, sync flags and totals before recording streams", async () => {
  const db = await openTestDatabase({ through: "0039_listening_history" });
  const track = addTrack(db, { title: "Existing song" });
  db.run(sql`INSERT INTO play_events (id, track_id, started_at, snapshot, listened_ms, end_reason, counted, sync_id, pushed, ongoing)
    VALUES (50, ${track}, 1000, '{"title":"Old title","artist":"Artist","album":null,"artworkPath":null,"thumbPath":null}', 20000, 'interrupted', 1, 'kept-sync-id', 1, 1)`);
  // The row above's totals, which the upgrade keeps.
  const before = { listenedMs: 20_000, countedPlays: 1, songsListened: 1, lastPlayedAt: 1000 };
  await migrateTestDatabase(db);
  assert.deepEqual(listeningSums(db), before);
  assert.equal(listeningHistory(db).rows[0]?.id, 50);
  assert.equal(listeningHistory(db).rows[0]?.snapshot.title, "Old title");
  assert.equal(latestPlay(db)?.id, 50);
  assert.deepEqual(selectUnpushed(db, 100, () => null).rows.plays, []);
  const id = recordPlay(
    db,
    { ...play(track, 2000), trackId: "yt:history-video" },
    false,
    streamedSong,
  );
  assert.ok(id > 50);
  assert.deepEqual(listeningSums(db), {
    // The streamed song is a second song listened.
    listenedMs: 40_000,
    countedPlays: 2,
    songsListened: 2,
    lastPlayedAt: 2000,
  });
  assert.deepEqual(playTotalsDrift(db), []);
});

test("mixed history keeps streamed and Library rows in stable time order across pages", async () => {
  const db = await openTestDatabase();
  const track = addTrack(db, { title: "Library song" });
  const expected = [];
  for (let i = 0; i < 60; i++) {
    const streamed = i % 2 === 0;
    expected.unshift(
      recordPlay(
        db,
        {
          ...play(track, Math.floor(i / 3)),
          trackId: streamed ? "yt:history-video" : String(track),
        },
        false,
        streamed ? streamedSong : undefined,
      ),
    );
  }
  const { result: first, queries } = traceQueries(db, () => listeningHistory(db));
  assert.equal(first.rows.length, 50);
  assert.ok(queries.every(({ rows }) => rows <= 51));
  const second = listeningHistory(db, first.next!);
  assert.deepEqual(
    [...first.rows, ...second.rows].map(({ id }) => id),
    expected,
  );
  assert.equal(second.next, null);
  assert.equal(first.rows[0]?.streamedSong, null);
  assert.equal(first.rows[1]?.streamedSong?.videoId, "history-video");
});

test("totals stay correct when an event changes between Library and video identity or is removed", async () => {
  const db = await openTestDatabase();
  const track = addTrack(db, { title: "Library song" });
  const id = recordPlay(db, play(track, 1000));
  db.update(schema.playEvents)
    .set({ trackId: null, videoId: "converted" })
    .where(eq(schema.playEvents.id, id))
    .run();
  assert.equal(listeningSums(db).countedPlays, 1);
  assert.equal(listeningSums(db).songsListened, 1);
  assert.deepEqual(playTotalsDrift(db), []);
  db.update(schema.playEvents)
    .set({ trackId: track, videoId: null })
    .where(eq(schema.playEvents.id, id))
    .run();
  assert.equal(listeningSums(db).countedPlays, 1);
  assert.deepEqual(playTotalsDrift(db), []);
  const stream = recordPlay(
    db,
    { ...play(track, 2000), trackId: "yt:history-video" },
    false,
    streamedSong,
  );
  db.delete(schema.playEvents).where(eq(schema.playEvents.id, stream)).run();
  assert.equal(listeningSums(db).countedPlays, 1);
  db.delete(schema.playEvents).where(eq(schema.playEvents.id, id)).run();
  assert.equal(listeningSums(db).countedPlays, 0);
  assert.deepEqual(playTotalsDrift(db), []);
});

test("the snapshot-sync upgrade preserves Library and streamed history and their pushed flags", async () => {
  const db = await openTestDatabase({ through: "0040_streamed_plays" });
  const track = addTrack(db, { title: "Library song" });
  const library = play(track, 1000);
  endPlay(db, recordPlay(db, library), library);
  const stream = { ...play(track, 2000), trackId: "yt:history-video" };
  endPlay(db, recordPlay(db, stream, false, streamedSong), stream);
  const outgoing = selectUnpushed(db, 100, () => null);
  markPushed(db, [...outgoing.marks.values()].flat());
  const before = listeningHistory(db);
  await migrateTestDatabase(db);
  assert.deepEqual(listeningHistory(db), before);
  assert.deepEqual(selectUnpushed(db, 100, () => null).rows.plays, []);
  assert.deepEqual(playTotalsDrift(db), []);
});
