/// <reference types="node" />
import type { PlayEvent, YtAlbumSong } from "@wave/core";
import assert from "node:assert/strict";
import { test } from "node:test";

import { sql } from "drizzle-orm";
import { creditSplits, relinkCredits } from "./credits.ts";
import { homePlays, recordPlay } from "./playHistory.ts";
import { addTrack, openTestDatabase, traceQueries, type TestDatabase } from "./testDatabase.ts";

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

const streamed = (
  videoId: string,
  album: string,
  albumId: string | null,
  artist: string,
): YtAlbumSong => ({
  videoId,
  title: `Song ${videoId}`,
  artists: [artist],
  album,
  albumId,
  artworkUrl: `https://cover/${videoId}`,
  durationMs: 180_000,
  explicit: false,
});

const stream = (db: TestDatabase, song: YtAlbumSong, at: number, counted = true) =>
  recordPlay(db, play(`yt:${song.videoId}`, at, counted), false, song);

const filler = (index: number) => {
  const name = String(index).padStart(2, "0");
  return streamed(`f${name}`, `Filler ${name}`, `MPREb_f${name}`, "F");
};

/**
 * A Library of three albums and 54 streamed songs, more than one page of the
 * shelf's reads: a download of a streamed song, a streamed song of a Library
 * album, an uncounted metadata-only song whose album only another (older)
 * song names, and 50 online albums, three of them played at the same moment.
 */
const seed = async () => {
  const db = await openTestDatabase();
  const kept = addTrack(db, { title: "Kept song", artist: "A", album: "Kept" });
  const downloaded = addTrack(db, { title: "Downloaded song", artist: "C", album: "Downloaded" });
  addTrack(db, { title: "Matched song", artist: "M", album: "Matched" });
  relinkCredits(db, creditSplits());
  db.run(sql`UPDATE tracks SET video_id = 'dl' WHERE id = ${downloaded}`);
  stream(db, streamed("r1", "Release", "MPREb_r", "R"), 1_500);
  for (let index = 0; index < 50; index++)
    stream(db, filler(index), index === 41 || index === 43 ? 1_642 : 1_600 + index);
  recordPlay(db, play(String(downloaded), 2_000));
  recordPlay(db, play(String(kept), 5_000));
  stream(db, streamed("r2", "Release", null, "R"), 7_000, false);
  stream(db, streamed("m1", "Matched", null, "M"), 8_000);
  stream(db, streamed("dl", "Streamed title", "MPREb_dl", "C"), 9_000);
  return db;
};

test("Recently played merges streamed albums by their latest play across many streams", async () => {
  const db = await seed();
  assert.deepEqual(
    homePlays(db).recentlyPlayed.map((album) => [album.title, "online" in album]),
    [
      ["Downloaded", false],
      ["Matched", false],
      ["Release", true],
      ["Kept", false],
      ["Filler 49", true],
      ["Filler 48", true],
      ["Filler 47", true],
      ["Filler 46", true],
      ["Filler 45", true],
      ["Filler 44", true],
      ["Filler 41", true],
      ["Filler 42", true],
    ],
  );
  const release = homePlays(db).recentlyPlayed[2]!;
  assert.ok("online" in release);
  assert.equal(release.albumId, "MPREb_r");
  assert.deepEqual(
    homePlays(db, "files").recentlyPlayed.map((album) => album.title),
    ["Kept", "Downloaded"],
  );
});

test("an online album on the shelf shows its latest played song's details", async () => {
  const db = await openTestDatabase();
  const first = streamed("a1", "Album", "MPREb_a", "A");
  stream(db, first, 1_000);
  stream(db, streamed("a2", "Album", "MPREb_a", "A"), 2_000);
  stream(db, first, 3_000);
  const [album] = homePlays(db).recentlyPlayed;
  assert.ok(album !== undefined && "online" in album);
  assert.equal(album.artworkUrl, "https://cover/a1");
});

test("Recently played reads streamed songs in a few queries however many were streamed", async () => {
  const db = await seed();
  const { queries } = traceQueries(db, () => homePlays(db).recentlyPlayed);
  const songReads = queries.filter((query) => /streamed_song/.test(query.sql));
  assert.ok(songReads.length <= 3, `${songReads.length} streamed-song reads`);
});

test("a tie where the latest songs stop goes to the album first by id, whichever was read", async () => {
  const db = await openTestDatabase();
  for (let index = 0; index < 47; index++) {
    const name = `B${String(index % 11).padStart(2, "0")}`;
    stream(db, streamed(`b${index}`, name, `MPREb_${name}`, "B"), 5_000 + index);
  }
  stream(db, streamed("ta", "Tie a", "MPREb_ta", "T"), 4_000);
  stream(db, streamed("tz", "Tie z", "MPREb_tz", "T"), 4_000);
  assert.deepEqual(
    homePlays(db).recentlyPlayed.map((played) => played.title),
    ["B02", "B01", "B00", "B10", "B09", "B08", "B07", "B06", "B05", "B04", "B03", "Tie a"],
  );
});
