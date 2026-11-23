/// <reference types="node" />
import { mixReplayContext, type PlayContext, type PlayEvent, type YtAlbumSong } from "@wave/core";
import assert from "node:assert/strict";
import { test } from "node:test";

import { sql } from "drizzle-orm";
import { creditSplits, relinkCredits } from "./credits.ts";
import { finishReplaySteps, readConnections, replayRead } from "./offThreadReads.ts";
import { homePlays, homePlaysRead, homePlaysSteps, recordPlay } from "./playHistory.ts";
import { createPlaylist, deletePlaylist } from "./playlists.ts";
import { contextSongs, type RecentlyPlayedEntry } from "./recentlyPlayed.ts";
import { addTrack, asyncReadClient, openTestDatabase, type TestDatabase } from "./testDatabase.ts";

const play = (id: string, at: number, context: PlayContext | null): PlayEvent => ({
  trackId: id,
  context,
  startedAt: at,
  listenedMs: 180_000,
  durationMs: 180_000,
  endReason: "completed",
  counted: true,
  source: "phone",
});

const streamed = (videoId: string, album: string, artist: string): YtAlbumSong => ({
  videoId,
  title: `Song ${videoId}`,
  artists: [artist],
  album,
  albumId: null,
  artworkUrl: `https://cover/${videoId}`,
  durationMs: 180_000,
  explicit: false,
});

const stream = (db: TestDatabase, song: YtAlbumSong, at: number, context: PlayContext | null) =>
  recordPlay(db, play(`yt:${song.videoId}`, at, context), false, song);

/** What a card shows, in a word or two: its kind and what names it. */
const card = (entry: RecentlyPlayedEntry): string => {
  switch (entry.kind) {
    case "playlist":
      return `playlist ${entry.playlist.name}`;
    case "ytPlaylist":
      return `ytPlaylist ${entry.context.id} ${entry.song?.title ?? "-"}`;
    case "album":
      return `album ${entry.album.title}${"online" in entry.album ? " (online)" : ""}`;
    case "artist":
      return `artist ${entry.artist.name}${"online" in entry.artist ? " (online)" : ""}`;
    case "song":
      return `song ${entry.song.title}${"videoId" in entry.song ? " (streamed)" : ""}`;
    case "mix":
      return `mix ${entry.context.kind}:${entry.context.id} ${entry.song?.title ?? "-"}`;
  }
};

/**
 * A Library of three songs on two albums, a playlist of two of them, and
 * plays from a playlist, an album, an artist, Search, the Songs list, a
 * streamed album, a streamed playlist, a streamed artist, a DJ and a mix.
 */
const seed = async () => {
  const db = await openTestDatabase();
  const one = addTrack(db, { title: "One", artist: "A", album: "First" });
  const two = addTrack(db, { title: "Two", artist: "A", album: "First" });
  const three = addTrack(db, { title: "Three", artist: "B", album: "Second" });
  relinkCredits(db, creditSplits());
  const { playlistId } = createPlaylist(
    db,
    "Road trip",
    [
      { source: "library", trackId: one },
      { source: "library", trackId: three },
    ],
    1,
  );
  const ids = db.all<{ album: number; artist: number }>(
    sql`SELECT (SELECT id FROM albums WHERE title = 'First') AS album,
      (SELECT id FROM artists WHERE name = 'B') AS artist`,
  )[0]!;
  stream(db, streamed("m1", "Mixed", "M"), 1_000, { kind: "discoverMix", id: "mix-1" });
  stream(db, streamed("d1", "Dj album", "D"), 1_100, { kind: "dj", id: "dj-1" });
  stream(db, streamed("x1", "Artist album", "X"), 1_200, { kind: "ytArtist", id: "name:X" });
  stream(db, streamed("p1", "List album", "P"), 1_300, { kind: "ytPlaylist", id: "PLx" });
  stream(db, streamed("a1", "Streamed album", "S"), 1_400, { kind: "ytAlbum", id: "MPREb_s" });
  recordPlay(db, play(String(two), 1_500, { kind: "songs", id: null }));
  recordPlay(db, play(String(one), 1_600, { kind: "search", id: null }));
  recordPlay(db, play(String(three), 1_700, { kind: "artist", id: String(ids.artist) }));
  recordPlay(db, play(String(two), 1_800, { kind: "album", id: String(ids.album) }));
  recordPlay(db, play(String(three), 1_900, { kind: "playlist", id: String(playlistId) }));
  recordPlay(db, play(String(one), 2_000, { kind: "playlist", id: String(playlistId) }));
  return { db, one, two, three, playlistId };
};

test("Recently played shows where each play came from, the latest first, each once", async () => {
  const { db } = await seed();
  assert.deepEqual(homePlays(db).recentlyPlayed.map(card), [
    "playlist Road trip",
    "album First",
    "artist B",
    "song One",
    "song Two",
    "album Streamed album (online)",
    "ytPlaylist PLx Song p1",
    "artist X (online)",
    "mix dj:dj-1 Song d1",
    "mix discoverMix:mix-1 Song m1",
  ]);
});

test("a streamed album's card opens its page; its details are its latest song's", async () => {
  const { db } = await seed();
  const album = homePlays(db).recentlyPlayed.find(
    (entry) => entry.kind === "album" && "online" in entry.album,
  );
  assert.ok(album?.kind === "album" && "online" in album.album);
  assert.equal(album.album.albumId, "MPREb_s");
  assert.equal(album.album.artworkUrl, "https://cover/a1");
  assert.equal(album.album.albumArtist, "S");
});

test("a song played on its own shows the song, its Library row once it's downloaded", async () => {
  const db = await openTestDatabase();
  const kept = addTrack(db, { title: "Kept", artist: "K", album: "Kept album" });
  db.run(sql`UPDATE tracks SET video_id = 'dl' WHERE id = ${kept}`);
  stream(db, streamed("s1", "Elsewhere", "S"), 1_000, { kind: "song", id: "yt:s1" });
  stream(db, streamed("r1", "Related", "R"), 1_100, { kind: "song", id: "yt:s1" });
  stream(db, streamed("dl", "Downloaded", "K"), 1_200, { kind: "search", id: null });
  assert.deepEqual(homePlays(db).recentlyPlayed.map(card), [
    "song Kept",
    "song Song s1 (streamed)",
  ]);
});

test("a mix played again from its card stays one card", async () => {
  const db = await openTestDatabase();
  const mix = { kind: "magic", id: "55" };
  stream(db, streamed("m1", "Mixed", "M"), 1_000, mix);
  stream(db, streamed("m2", "Mixed", "M"), 1_100, mixReplayContext(mix));
  assert.deepEqual(homePlays(db).recentlyPlayed.map(card), ["mix magic:55 Song m2"]);
});

test("a mix's songs, to play it again: those played in it, once each, in the order they played", async () => {
  const db = await openTestDatabase();
  const mix = { kind: "dj", id: "7" };
  const kept = addTrack(db, { title: "Kept", artist: "K", album: "Kept album" });
  stream(db, streamed("m1", "Mixed", "M"), 1_000, mix);
  recordPlay(db, play(String(kept), 1_100, mix));
  stream(db, streamed("m1", "Mixed", "M"), 1_200, mixReplayContext(mix));
  stream(db, streamed("m2", "Mixed", "M"), 1_300, mixReplayContext(mix));
  stream(db, streamed("o1", "Other", "O"), 1_400, { kind: "dj", id: "8" });
  assert.deepEqual(
    contextSongs(db, mix).map((song) => song.title),
    ["Song m1", "Kept", "Song m2"],
  );
});

test("Android Auto's shelf (songs with a file) leaves out what it can't open or play", async () => {
  const { db } = await seed();
  assert.deepEqual(homePlays(db, "files").recentlyPlayed.map(card), [
    "playlist Road trip",
    "album First",
    "artist B",
    "song One",
    "song Two",
  ]);
});

test("a gone playlist or album leaves the shelf", async () => {
  const { db, playlistId } = await seed();
  deletePlaylist(db, playlistId, 3);
  assert.ok(!homePlays(db).recentlyPlayed.some((entry) => entry.kind === "playlist"));
});

test("Recently played reads a page of plays at a time, however long the history", async () => {
  const db = await openTestDatabase();
  for (let index = 0; index < 300; index++)
    stream(db, streamed(`f${index}`, "Same album", "F"), 1_000 + index, {
      kind: "ytAlbum",
      id: "MPREb_same",
    });
  for (let index = 0; index < 11; index++)
    stream(db, streamed(`g${index}`, `Album ${index}`, "G"), 500 + index, {
      kind: "search",
      id: null,
    });
  const shelf = homePlays(db).recentlyPlayed;
  assert.equal(shelf.length, 12);
  assert.equal(card(shelf[0]!), "album Same album (online)");
  assert.equal(card(shelf[1]!), "song Song g10 (streamed)");
});

test("Home's plays read for a replay are homePlays' (#1452)", async () => {
  const { db } = await seed();
  const reads = readConnections(async () => asyncReadClient(db));
  for (const scope of ["library", "files"] as const) {
    const read = await replayRead(
      reads,
      (d) => homePlaysRead(d, scope),
      () => 0,
    );
    assert.deepEqual(
      (await finishReplaySteps(homePlaysSteps(read.value), () => 0)).value,
      homePlays(db, scope),
      scope,
    );
  }
});
