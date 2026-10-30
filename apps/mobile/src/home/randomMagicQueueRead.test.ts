import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import type { MagicQueueSeed, PlaylistSong, YtSong } from "@wave/core";
import { sql } from "drizzle-orm";
import * as Effect from "effect/Effect";

import { loadLibraryStore } from "../../bench/fastAgain/store.ts";
import {
  addMissingSong,
  addTrack,
  closeTestDatabase,
  openTestDatabase,
  traceQueries,
} from "../library/db/testDatabase.ts";
import type { PlayableSongRow } from "../library/LibraryStore.ts";
import { randomMagicQueueRead } from "./randomMagicQueueRead.ts";

const root = fileURLToPath(new URL("../../../../", import.meta.url));

/** What a seed shows: a Library song's id, or a streamed entry's video id. */
const seedIds = (seeds: readonly MagicQueueSeed<PlayableSongRow>[]) =>
  seeds.map((seed) => (seed.source === "library" ? seed.song.id : seed.song.videoId));

const ytSong = (videoId: string): YtSong => ({
  videoId,
  title: `Streamed ${videoId}`,
  artists: ["Someone"],
  album: null,
  durationMs: 200_000,
  artworkUrl: `https://example.com/${videoId}.jpg`,
  explicit: false,
});

const streamed = (videoId: string): PlaylistSong => ({ source: "stream", song: ytSong(videoId) });

const listed = {
  title: "Listed",
  artists: ["Someone"],
  album: null,
  durationMs: null,
  artworkUrl: null,
};

test("a Home opening draws nine never-played files with id reads, then their songs, and no recommendation inputs", async () => {
  const db = await openTestDatabase();
  try {
    const ids = Array.from({ length: 12 }, (_, i) => addTrack(db, { title: `Song ${i}` }));
    addMissingSong(db, { title: "Missing file" });
    const store = await loadLibraryStore(root, db);
    const read = randomMagicQueueRead(() => 0);
    const measured = traceQueries(db, () => Effect.runSync(read.read(store)));
    assert.deepEqual(seedIds(measured.result), ids.slice(0, 9));
    assert.deepEqual(
      measured.queries.map((query) => query.rows),
      [12, 0, 9],
    );
    assert.ok(measured.queries.every((query) => !/play_events|candidate_catalog/.test(query.sql)));
    const reopened = randomMagicQueueRead(() => 0.999);
    assert.deepEqual(seedIds(Effect.runSync(reopened.read(store))), [ids[11], ...ids.slice(0, 8)]);
    const undo = randomMagicQueueRead(() => 0.999, seedIds(measured.result));
    assert.deepEqual(seedIds(Effect.runSync(undo.read(store))), ids.slice(0, 9));
  } finally {
    closeTestDatabase(db);
  }
});

test("an empty or small Library needs no loading, taste, or recommendation fallback", async () => {
  const db = await openTestDatabase();
  try {
    const store = await loadLibraryStore(root, db);
    const read = randomMagicQueueRead(() => 0.999);
    assert.deepEqual(Effect.runSync(read.read(store)), []);
    const ids = [addTrack(db, { title: "First song" }), addTrack(db, { title: "Second song" })];
    assert.deepEqual(seedIds(Effect.runSync(read.read(store))), ids.toReversed());
  } finally {
    closeTestDatabase(db);
  }
});

test("a visit keeps its seeds through re-reads, replacing a removed file and filling a growing Library", async () => {
  const db = await openTestDatabase();
  try {
    const ids = Array.from({ length: 10 }, (_, i) => addTrack(db, { title: `Song ${i}` }));
    const store = await loadLibraryStore(root, db);
    let draw = 0;
    const read = randomMagicQueueRead(() => draw);
    assert.deepEqual(seedIds(Effect.runSync(read.read(store))), ids.slice(0, 9));
    draw = 0.999;
    assert.deepEqual(seedIds(Effect.runSync(read.read(store))), ids.slice(0, 9));
    await Effect.runPromise(store.removeSongs([ids[3]!]));
    assert.deepEqual(seedIds(Effect.runSync(read.read(store))), [
      ...ids.slice(0, 3),
      ids[9],
      ...ids.slice(4, 9),
    ]);
    await Effect.runPromise(store.removeSongs(ids.slice(4)));
    assert.deepEqual(seedIds(Effect.runSync(read.read(store))), ids.slice(0, 3));
    const added = addTrack(db, { title: "Just scanned" });
    assert.deepEqual(seedIds(Effect.runSync(read.read(store))), [...ids.slice(0, 3), added]);
  } finally {
    closeTestDatabase(db);
  }
});

test("the playlists' YT Music entries join the files, each video once, none the Library has", async () => {
  const db = await openTestDatabase();
  try {
    const file = addTrack(db, { title: "File" });
    const downloaded = addTrack(db, { title: "Downloaded" });
    db.run(sql`UPDATE tracks SET video_id = 'have' WHERE id = ${downloaded}`);
    const store = await loadLibraryStore(root, db);
    await Effect.runPromise(
      store.createPlaylist("Liked Songs", [
        streamed("a"),
        streamed("have"),
        { source: "library", trackId: file },
        { source: "unsearched", song: listed },
        { source: "unavailable", song: { ...listed, title: "Gone", reason: "notFound" } },
      ]),
    );
    await Effect.runPromise(store.createPlaylist("Road trip", [streamed("a"), streamed("b")]));
    const gone = await Effect.runPromise(store.createPlaylist("Deleted", [streamed("c")]));
    await Effect.runPromise(store.deletePlaylist(gone.playlistId));
    const read = randomMagicQueueRead(() => 0);
    const measured = traceQueries(db, () => Effect.runSync(read.read(store)));
    assert.deepEqual(seedIds(measured.result), [file, downloaded, "a", "b"]);
    const entry = measured.result.find((seed) => seed.source === "stream");
    assert.deepEqual(entry?.song, { ...ytSong("a"), albumId: null });
    assert.ok(measured.queries.every((query) => !/play_events|candidate_catalog/.test(query.sql)));
  } finally {
    closeTestDatabase(db);
  }
});

test("with no files the row draws from the playlists' entries", async () => {
  const db = await openTestDatabase();
  try {
    const store = await loadLibraryStore(root, db);
    await Effect.runPromise(store.createPlaylist("Liked Songs", [streamed("x"), streamed("y")]));
    const read = randomMagicQueueRead(() => 0.999);
    assert.deepEqual(seedIds(Effect.runSync(read.read(store))), ["y", "x"]);
  } finally {
    closeTestDatabase(db);
  }
});

test("an entry removed from its playlist is replaced in its place", async () => {
  const db = await openTestDatabase();
  try {
    const store = await loadLibraryStore(root, db);
    const songs = Array.from({ length: 10 }, (_, i) => streamed(`v${i}`));
    const { playlistId } = await Effect.runPromise(store.createPlaylist("Liked Songs", songs));
    const read = randomMagicQueueRead(() => 0);
    const first = seedIds(Effect.runSync(read.read(store)));
    assert.equal(first.length, 9);
    const detail = await Effect.runPromise(store.getPlaylist(playlistId));
    const item = detail?.items.find(
      (entry) => entry.source === "stream" && entry.song.videoId === first[4],
    );
    assert.ok(item !== undefined);
    await Effect.runPromise(store.removePlaylistItems(playlistId, [item.itemId]));
    const left = songs
      .map((song) => (song.source === "stream" ? song.song.videoId : ""))
      .filter((id) => !first.includes(id));
    assert.deepEqual(seedIds(Effect.runSync(read.read(store))), [
      ...first.slice(0, 4),
      ...left,
      ...first.slice(5),
    ]);
  } finally {
    closeTestDatabase(db);
  }
});

test("forty thousand playlist entries are read as ids, then nine songs", async () => {
  const db = await openTestDatabase();
  try {
    const store = await loadLibraryStore(root, db);
    for (let list = 0; list < 40; list++)
      await Effect.runPromise(
        store.createPlaylist(
          `List ${list}`,
          Array.from({ length: 1_000 }, (_, i) => streamed(`v${(list * 1_000 + i) % 30_000}`)),
        ),
      );
    const read = randomMagicQueueRead(Math.random);
    const measured = traceQueries(db, () => Effect.runSync(read.read(store)));
    assert.equal(measured.result.length, 9);
    const entryReads = measured.queries.filter((query) => /playlist_items/.test(query.sql));
    assert.equal(entryReads.length, 2);
    assert.equal(entryReads[0]!.rows, 30_000);
    assert.ok(entryReads[1]!.rows <= 18, `${entryReads[1]!.rows} entries decoded`);
  } finally {
    closeTestDatabase(db);
  }
});
