import { test } from "node:test";
import assert from "node:assert/strict";
import { sql } from "drizzle-orm";
import initSqlJs from "sql.js";

import { creditSplits } from "./credits.ts";
import { selectKnownVideos } from "./mixKnown.ts";
import {
  REFERENCE_SIZE,
  buildReferenceDatabase,
  referenceCatalogue,
  referenceFixture,
  scannedTrack,
  seedReferenceLibrary,
  type ReferenceSize,
} from "./referenceSeed.ts";
import { saveBatch } from "./save.ts";
import { openTestDatabase, type TestDatabase } from "./testDatabase.ts";

const SMALL: ReferenceSize = {
  songs: 120,
  artists: 30,
  albums: 50,
  playlists: 6,
  playlistEntries: 700,
  knownVideos: 500,
  plays: 400,
  follows: 3,
  favorites: 10,
};

const ROOT = "/storage/emulated/0/Music";
const facts = { sizeBytes: 4_000, modifiedAt: 1_700_000_000_000 };
const NOW = 1_760_000_000_000;

const count = (db: TestDatabase, table: string, where = ""): number =>
  db.get<{ n: number }>(sql.raw(`SELECT count(*) AS n FROM ${table} ${where}`))!.n;

const seeded = async (size = SMALL) => {
  const catalogue = referenceCatalogue(size);
  const db = await openTestDatabase();
  seedReferenceLibrary(db, catalogue, { root: ROOT, facts: () => facts, now: NOW });
  return { db, catalogue };
};

test("the catalogue is the same every time and every file has a path of its own", () => {
  const a = referenceCatalogue(SMALL);
  const b = referenceCatalogue(SMALL);
  assert.deepEqual(a, b);
  assert.equal(a.songs.length, SMALL.songs);
  assert.equal(new Set(a.songs.map((song) => song.file)).size, SMALL.songs);
  assert.equal(new Set(a.songs.map((song) => song.artist)).size, SMALL.artists);
  assert.equal(new Set(a.songs.map((song) => `${song.artist}\n${song.album}`)).size, SMALL.albums);
  // Names stay plain so no credit splits and no voice-note rule skips a file.
  for (const song of a.songs) {
    assert.match(song.file, /^[A-Za-z0-9 ]+\/[A-Za-z0-9 ]+\/\d{2} [A-Za-z0-9 ]+\.mp3$/);
    assert.ok(song.durationMs >= 120_000);
  }
});

test("the seeded Library holds the catalogue's songs, artists and albums", async () => {
  const { db } = await seeded();
  assert.equal(count(db, "tracks", "WHERE path IS NOT NULL"), SMALL.songs);
  assert.equal(count(db, "albums"), SMALL.albums);
  assert.equal(count(db, "artists"), SMALL.artists);
  assert.equal(count(db, "scan_roots"), 1);
  assert.equal(count(db, "scan_roots", "WHERE last_scanned_at IS NOT NULL"), 1);
});

test("playlists, known videos, plays, favorites and follows reach their sizes", async () => {
  const { db } = await seeded();
  assert.equal(count(db, "playlists"), SMALL.playlists);
  assert.equal(count(db, "playlist_items"), SMALL.playlistEntries);
  const streamed = count(db, "playlist_items", "WHERE yt_song IS NOT NULL");
  assert.ok(streamed > 0 && streamed < SMALL.playlistEntries, `${streamed} YT Music entries`);
  assert.equal(selectKnownVideos(db).length, SMALL.knownVideos);
  assert.equal(count(db, "play_events"), SMALL.plays);
  assert.ok(count(db, "play_events", "WHERE video_id IS NOT NULL") > 0);
  assert.equal(count(db, "play_events", "WHERE ongoing = 1"), 0);
  assert.equal(count(db, "follows"), SMALL.follows);
});

test("a scan reading the files' tags again settles at the seeded counts", async () => {
  const { db, catalogue } = await seeded();
  const tracks = catalogue.songs.map((song) => scannedTrack(song, ROOT, facts));
  for (let i = 0; i < tracks.length; i += 100)
    saveBatch(db, creditSplits(), tracks.slice(i, i + 100), [], [], NOW + 1, {
      linkEntries: false,
    });
  assert.equal(count(db, "tracks", "WHERE path IS NOT NULL"), SMALL.songs);
  assert.equal(count(db, "albums"), SMALL.albums);
  assert.equal(count(db, "artists"), SMALL.artists);
  assert.equal(count(db, "playlist_items"), SMALL.playlistEntries);
});

test("the fixture names an artist and a playlist the seed makes, first in their lists", async () => {
  const { db, catalogue } = await seeded();
  const fixture = referenceFixture(catalogue);
  const artists = db
    .all<{ name: string }>(sql`SELECT name FROM artists ORDER BY sort, name`)
    .map((row) => row.name);
  assert.equal(artists[0], fixture.artist);
  const playlists = catalogue.playlists.map((playlist) => playlist.name).sort();
  assert.equal(playlists[0], fixture.playlist);
});

test("the built database opens on its own with the seeded rows", async () => {
  const catalogue = referenceCatalogue(SMALL);
  const bytes = buildReferenceDatabase(catalogue, { root: ROOT, facts: () => facts, now: NOW });
  const SQL = await initSqlJs();
  const reopened = new SQL.Database(await bytes);
  const [result] = reopened.exec("SELECT count(*) FROM tracks");
  assert.equal(result?.values[0]?.[0], SMALL.songs);
  reopened.close();
});

test("the default size is the reference phone's", () => {
  assert.deepEqual(
    {
      songs: REFERENCE_SIZE.songs,
      artists: REFERENCE_SIZE.artists,
      albums: REFERENCE_SIZE.albums,
      playlistEntries: REFERENCE_SIZE.playlistEntries,
      knownVideos: REFERENCE_SIZE.knownVideos,
    },
    { songs: 3_000, artists: 900, albums: 1_500, playlistEntries: 26_700, knownVideos: 20_500 },
  );
});
