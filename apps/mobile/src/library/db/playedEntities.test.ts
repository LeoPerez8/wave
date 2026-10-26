/// <reference types="node" />
import { artistStats, type PlayEvent, type YtAlbumSong } from "@wave/core";
import assert from "node:assert/strict";
import { test } from "node:test";

import { creditSplits, relinkCredits } from "./credits.ts";
import { homePlays, recordPlay } from "./playHistory.ts";
import { playedArtistSongs, playedEntityTotals } from "./playedEntities.ts";
import { sql } from "drizzle-orm";
import { addTrack, openTestDatabase, traceQueries } from "./testDatabase.ts";

const song: YtAlbumSong = {
  videoId: "collaboration",
  title: "Song",
  artists: ["A feat. B"],
  album: "Album (Deluxe)",
  albumId: "release",
  artworkUrl: "https://cover",
  durationMs: 180_000,
  explicit: false,
};
const play = (id: string, at: number, counted = true): PlayEvent => ({
  trackId: id,
  context: null,
  startedAt: at,
  listenedMs: 180_000,
  durationMs: 180_000,
  endReason: "completed",
  counted,
  source: "phone",
});

test("all-time excludes future streams without counting an older recording key twice", async () => {
  const db = await openTestDatabase();
  recordPlay(db, play("yt:collaboration", 1_000), false, song);
  const changed = { ...song, title: "New title" };
  recordPlay(db, play("yt:collaboration", 2_000), false, changed);
  recordPlay(db, play("yt:collaboration", 20_000), false, changed);
  const totals = playedEntityTotals(db, { from: null, to: 10_000 });
  assert.deepEqual(
    totals.artists.map(({ item, countedPlays }) => [item.name, countedPlays]),
    [
      ["A", 2],
      ["B", 2],
    ],
  );
  assert.equal(totals.albums[0]!.countedPlays, 2);
});

test("Stats and Home combine streamed credits with Library artists and albums", async () => {
  const db = await openTestDatabase();
  const id = addTrack(db, { title: "Local", artist: "A", album: "Album" });
  relinkCredits(db, creditSplits());
  recordPlay(db, play(String(id), 1_000));
  recordPlay(db, play("yt:collaboration", 2_000), false, song);
  recordPlay(db, play("yt:collaboration", 3_000, false), false, song);
  const totals = playedEntityTotals(db, { from: null, to: 10_000 });
  assert.deepEqual(
    totals.artists.map(({ item, countedPlays }) => [item.name, countedPlays]),
    [
      ["A", 2],
      ["B", 1],
    ],
  );
  assert.deepEqual(
    totals.albums.map(({ item, countedPlays }) => [item.title, countedPlays]),
    [["Album", 2]],
  );
  assert.equal(typeof totals.albums[0]!.item.id, "number");
  const windowed = playedEntityTotals(db, { from: 2_000, to: 2_000 });
  assert.deepEqual(
    windowed.artists.map(({ item, countedPlays }) => [item.name, countedPlays]),
    [
      ["A", 1],
      ["B", 1],
    ],
  );
});

test("a download transfers streamed plays to its current album and credits", async () => {
  const db = await openTestDatabase();
  recordPlay(db, play("yt:collaboration", 1_000), false, song);
  const id = addTrack(db, { title: "Downloaded", artist: "C feat. D", album: "Tagged album" });
  relinkCredits(db, creditSplits());
  db.run(sql`UPDATE tracks SET video_id = 'collaboration' WHERE id = ${id}`);
  recordPlay(db, play(String(id), 2_000));
  const totals = playedEntityTotals(db, { from: null, to: 10_000 });
  assert.deepEqual(
    totals.artists.map(({ item, countedPlays }) => [item.name, countedPlays]),
    [
      ["C", 2],
      ["D", 2],
    ],
  );
  assert.deepEqual(
    totals.albums.map(({ item, countedPlays }) => [item.title, countedPlays]),
    [["Tagged album", 2]],
  );
});

test("Recently played includes streamed albums in latest-play order and Auto stays file-only", async () => {
  const db = await openTestDatabase();
  const local = addTrack(db, { title: "Local", artist: "A", album: "Album" });
  relinkCredits(db, creditSplits());
  recordPlay(db, play(String(local), 1_000));
  recordPlay(db, play("yt:collaboration", 2_000), false, song);
  const online = {
    ...song,
    videoId: "other",
    album: "Online album",
    artists: ["Other"],
    albumId: null,
  };
  recordPlay(db, play("yt:other", 3_000, false), false, online);
  assert.deepEqual(
    homePlays(db).recentlyPlayed.map((album) => album.title),
    ["Online album", "Album"],
  );
  assert.deepEqual(
    homePlays(db, "files").recentlyPlayed.map((album) => album.title),
    ["Album"],
  );
});

test("the Library artist's Stats block includes stream credits, skips and downloaded song coverage", async () => {
  const db = await openTestDatabase();
  const id = addTrack(db, { title: "Local", artist: "A", album: "Album" });
  relinkCredits(db, creditSplits());
  const artistId = db.get<{ id: number }>(sql`SELECT id FROM artists WHERE name = 'A'`).id;
  recordPlay(db, play("yt:collaboration", 1_000), false, song);
  recordPlay(db, { ...play("yt:collaboration", 2_000, false), listenedMs: 30_000 }, false, song);
  const before = playedArtistSongs(db, artistId, 10_000);
  const stats = artistStats({ ...before, artistId, now: 10_000 });
  assert.equal(stats.played && stats.plays, "1 play");
  assert.equal(stats.played && stats.minutesListened, "3 minutes listened");
  assert.equal(stats.played && stats.songsListened, "0 of 1 song");
  assert.equal(before.streamedSongPlays[0]!.song.kind, "yt");
  db.run(sql`UPDATE tracks SET video_id = 'collaboration' WHERE id = ${id}`);
  const after = playedArtistSongs(db, artistId, 10_000);
  const downloaded = artistStats({ ...after, artistId, now: 10_000 });
  assert.equal(downloaded.played && downloaded.plays, "1 play");
  assert.equal(downloaded.played && downloaded.songsListened, "1 of 1 song");
  assert.equal(after.streamedSongPlays.length, 0);
  assert.equal(downloaded.played && downloaded.mostPlayed[0]!.countedPlays, 1);
});

test("all-time artist and album totals never scan raw play history", async () => {
  const db = await openTestDatabase();
  recordPlay(db, play("yt:collaboration", 1_000), false, song);
  const { queries } = traceQueries(db, () => playedEntityTotals(db, { from: null, to: 10_000 }));
  for (const query of queries)
    assert.deepEqual(
      query.plan.filter((step) => /\bSCAN play_events\b/.test(step)),
      [],
      query.sql,
    );
  for (const query of queries)
    for (const step of query.plan.filter((plan) => /\bSEARCH play_events\b/.test(plan)))
      assert.match(step, /play_events_(video|track)_idx \((video|track)_id=\?\)/, query.sql);
});

test("recording-key downloads transfer album and artist counts without a video id", async () => {
  const db = await openTestDatabase();
  const eventId = recordPlay(db, play("yt:collaboration", 1_000), false, song);
  const id = addTrack(db, { title: "Downloaded", artist: "Tagged artist", album: "Tagged album" });
  relinkCredits(db, creditSplits());
  db.run(
    sql`UPDATE tracks SET recording_key = (SELECT recording_key FROM play_events WHERE id = ${eventId}) WHERE id = ${id}`,
  );
  const totals = playedEntityTotals(db, { from: null, to: 10_000 });
  assert.deepEqual(
    totals.artists.map(({ item, countedPlays }) => [item.name, countedPlays]),
    [["Tagged artist", 1]],
  );
  assert.deepEqual(
    totals.albums.map(({ item, countedPlays }) => [item.title, countedPlays]),
    [["Tagged album", 1]],
  );
});

test("snapshot-only streamed metadata ranks with its cover and credits after sync", async () => {
  const db = await openTestDatabase();
  const id = recordPlay(db, play("yt:collaboration", 1_000), false, song);
  db.run(sql`UPDATE play_events SET streamed_song = NULL WHERE id = ${id}`);
  const totals = playedEntityTotals(db, { from: null, to: 10_000 });
  assert.deepEqual(
    totals.artists.map(({ item }) => item.name),
    ["A", "B"],
  );
  const album = totals.albums[0]!.item;
  assert.ok("online" in album);
  assert.equal(album.artworkUrl, "https://cover");
  assert.equal(album.albumId, null);
  assert.equal(totals.albums[0]!.countedPlays, 1);
});
