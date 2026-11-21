import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import type { MagicQueueSeed, PlayEvent, PlaylistSong, YtSong } from "@wave/core";
import { sql } from "drizzle-orm";
import * as Effect from "effect/Effect";

import { loadLibraryStore } from "../../bench/fastAgain/store.ts";
import {
  addMissingSong,
  addTrack,
  closeTestDatabase,
  openTestDatabase,
  traceQueries,
} from "@wave/client/testing";
import type { PlayableSongRow } from "@wave/client";
import { readPlaylistSeedIds } from "./playlistSeedIds.ts";
import { magicQueuePagesRead } from "./magicQueuePagesRead.ts";

const root = fileURLToPath(new URL("../../../../", import.meta.url));

type Store = Awaited<ReturnType<typeof loadLibraryStore>>;

/** The pool's entries, read at once. */
const sources = (store: Store) => ({ entryVideoIds: readPlaylistSeedIds(store, Effect.void) });

/** What the pages show: a Library song's id, or a streamed entry's video id. */
const seedIds = (pages: readonly (readonly MagicQueueSeed<PlayableSongRow>[])[]) =>
  pages.map((page) =>
    page.map((seed) => (seed.source === "library" ? seed.song.id : seed.song.videoId)),
  );

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

const play = (trackId: number | string): PlayEvent => ({
  trackId: String(trackId),
  context: null,
  startedAt: Date.UTC(2026, 10, 1),
  listenedMs: 180_000,
  durationMs: 180_000,
  endReason: "completed",
  counted: true,
  source: "phone",
});

const fresh = { kind: "fresh" } as const;

test("a Home opening draws three pages of nine from ids, then reads only the drawn songs", async () => {
  const db = await openTestDatabase();
  try {
    const ids = Array.from({ length: 30 }, (_, i) => addTrack(db, { title: `Song ${i}` }));
    addMissingSong(db, { title: "Missing file" });
    const store = await loadLibraryStore(root, db);
    const read = magicQueuePagesRead(() => 0, fresh);
    const measured = traceQueries(db, () => Effect.runSync(read.read(store, sources(store))));
    const pages = seedIds(measured.result);
    assert.deepEqual(
      pages.map((page) => page.length),
      [9, 9, 9],
    );
    assert.equal(new Set(pages.flat()).size, 27);
    assert.ok(pages.flat().every((id) => ids.includes(id as number)));
    const songReads = measured.queries.filter((query) => /FROM .?tracks/i.test(query.sql));
    assert.equal(songReads.at(-1)!.rows, 27, "only the drawn songs' metadata is read");
    assert.ok(measured.queries.every((query) => !/candidate_catalog/.test(query.sql)));
  } finally {
    closeTestDatabase(db);
  }
});

test("each page's never-played share follows the New music level read at the draw", async () => {
  const db = await openTestDatabase();
  try {
    const ids = Array.from({ length: 60 }, (_, i) => addTrack(db, { title: `Song ${i}` }));
    const store = await loadLibraryStore(root, db);
    const heard = new Set(ids.slice(0, 30));
    for (const id of heard) Effect.runSync(store.recordPlay(play(id), false));
    const newOn = (level: 1 | 5) =>
      seedIds(
        Effect.runSync(
          magicQueuePagesRead(Math.random, fresh).read(store, {
            ...sources(store),
            levels: () => ({ level, popularity: 3 }),
          }),
        ),
      ).map((page) => page.filter((id) => !heard.has(id as number)).length);
    assert.deepEqual(newOn(1), [2, 2, 2]);
    assert.deepEqual(newOn(5), [9, 9, 9]);
  } finally {
    closeTestDatabase(db);
  }
});

test("a streamed play counts its playlist entry as played", async () => {
  const db = await openTestDatabase();
  try {
    const store = await loadLibraryStore(root, db);
    const videos = Array.from({ length: 12 }, (_, i) => `v${i}`);
    await Effect.runPromise(store.createPlaylist("Liked Songs", videos.map(streamed)));
    for (const id of videos.slice(0, 6))
      Effect.runSync(store.recordPlay(play(`yt:${id}`), false, { ...ytSong(id), albumId: null }));
    const [page] = seedIds(
      Effect.runSync(
        magicQueuePagesRead(Math.random, fresh).read(store, {
          ...sources(store),
          levels: () => ({ level: 1, popularity: 3 }),
        }),
      ),
    );
    // Level 1: two of nine never played, the six played ones fill the rest they can.
    assert.equal(page!.filter((id) => videos.slice(0, 6).includes(id as string)).length, 6);
  } finally {
    closeTestDatabase(db);
  }
});

test("Popularity leans the draw towards the hits", async () => {
  const db = await openTestDatabase();
  try {
    const ids = Array.from({ length: 40 }, (_, i) => addTrack(db, { title: `Song ${i}` }));
    const store = await loadLibraryStore(root, db);
    const hits = new Set(ids.slice(0, 20));
    let picked = 0;
    for (let run = 0; run < 40; run++)
      picked += seedIds(
        Effect.runSync(
          magicQueuePagesRead(Math.random, fresh).read(store, {
            ...sources(store),
            popularity: Effect.succeed((id) => (hits.has(id as number) ? 1 : 0)),
            levels: () => ({ level: 3, popularity: 1 }),
          }),
        ),
      )[0]!.filter((id) => hits.has(id as number)).length;
    assert.ok(picked / (40 * 9) > 0.7, `${picked} hits`);
  } finally {
    closeTestDatabase(db);
  }
});

test("a visit keeps its pages through re-reads, replacing a removed file in its place", async () => {
  const db = await openTestDatabase();
  try {
    Array.from({ length: 30 }, (_, i) => addTrack(db, { title: `Song ${i}` }));
    const store = await loadLibraryStore(root, db);
    const read = magicQueuePagesRead(Math.random, fresh);
    const first = seedIds(Effect.runSync(read.read(store, sources(store))));
    assert.deepEqual(seedIds(Effect.runSync(read.read(store, sources(store)))), first);
    const gone = first[1]![3] as number;
    await Effect.runPromise(store.removeSongs([gone]));
    const after = seedIds(Effect.runSync(read.read(store, sources(store))));
    assert.deepEqual(after[0], first[0]);
    assert.deepEqual(after[2], first[2]);
    assert.deepEqual(
      after[1]!.filter((_, place) => place !== 3),
      first[1]!.filter((_, place) => place !== 3),
    );
    assert.notEqual(after[1]![3], gone);
  } finally {
    closeTestDatabase(db);
  }
});

test("a redraw brings new songs to the page in sight only, and Undo puts the page back", async () => {
  const db = await openTestDatabase();
  try {
    Array.from({ length: 60 }, (_, i) => addTrack(db, { title: `Song ${i}` }));
    const store = await loadLibraryStore(root, db);
    const shown = seedIds(
      Effect.runSync(magicQueuePagesRead(Math.random, fresh).read(store, sources(store))),
    );
    const redrawn = seedIds(
      Effect.runSync(
        magicQueuePagesRead(Math.random, { kind: "redraw", pages: shown, index: 2 }).read(
          store,
          sources(store),
        ),
      ),
    );
    assert.deepEqual(redrawn.slice(0, 2), shown.slice(0, 2));
    assert.equal(redrawn[2]!.filter((id) => shown.flat().includes(id)).length, 0);
    const undone = seedIds(
      Effect.runSync(
        magicQueuePagesRead(Math.random, { kind: "keep", pages: shown }).read(
          store,
          sources(store),
        ),
      ),
    );
    assert.deepEqual(undone, shown);
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
      ]),
    );
    await Effect.runPromise(store.createPlaylist("Road trip", [streamed("a"), streamed("b")]));
    const pages = Effect.runSync(magicQueuePagesRead(() => 0, fresh).read(store, sources(store)));
    assert.deepEqual(
      seedIds(pages).flat().map(String).toSorted(),
      [String(file), String(downloaded), "a", "b"].toSorted(),
    );
    const entry = pages.flat().find((seed) => seed.source === "stream");
    assert.deepEqual(entry?.song, { ...ytSong(entry!.song.videoId), albumId: null });
  } finally {
    closeTestDatabase(db);
  }
});

test("an empty Library draws no page", async () => {
  const db = await openTestDatabase();
  try {
    const store = await loadLibraryStore(root, db);
    assert.deepEqual(
      Effect.runSync(magicQueuePagesRead(() => 0, fresh).read(store, sources(store))),
      [],
    );
  } finally {
    closeTestDatabase(db);
  }
});

test("an entry whose song can't be read gives its place to another", async () => {
  const db = await openTestDatabase();
  try {
    const store = await loadLibraryStore(root, db);
    const songs = Array.from({ length: 9 }, (_, i) => streamed(`v${i}`));
    const { playlistId } = await Effect.runPromise(store.createPlaylist("Liked Songs", songs));
    db.run(sql`INSERT INTO playlist_items
      (playlist_id, yt_song, order_key, added_at, changed_at, sync_id, phone_id)
      VALUES (${playlistId}, '{"videoId":"a-broken"}', 'zz', 0, 0, 'broken', 'phone')`);
    const read = magicQueuePagesRead(Math.random, fresh);
    const shown = seedIds(Effect.runSync(read.read(store, sources(store))));
    assert.deepEqual(
      shown.flat().map(String).toSorted(),
      songs.map((song) => (song.source === "stream" ? song.song.videoId : "")),
    );
    assert.deepEqual(seedIds(Effect.runSync(read.read(store, sources(store)))), shown);
  } finally {
    closeTestDatabase(db);
  }
});

test("a disliked song, a file or a playlist's entry, is never drawn", async () => {
  const db = await openTestDatabase();
  try {
    const ids = Array.from({ length: 3 }, (_, i) => addTrack(db, { title: `Song ${i}` }));
    const store = await loadLibraryStore(root, db);
    await Effect.runPromise(store.createPlaylist("Liked Songs", [streamed("x"), streamed("y")]));
    const dislike = (key: string) => ({ key, title: key, artists: ["Someone"], durationMs: null });
    Effect.runSync(store.setDislikes([dislike(String(ids[1])), dislike("yt:x")]));
    const disliked = Effect.map(
      store.listDislikes,
      (songs) => new Set(songs.map((song) => song.key)),
    ).pipe(Effect.orDie);
    const pages = Effect.runSync(
      magicQueuePagesRead(() => 0, fresh).read(store, { ...sources(store), disliked }),
    );
    assert.deepEqual(seedIds(pages).flat().map(String).toSorted(), [
      String(ids[0]),
      String(ids[2]),
      "y",
    ]);
  } finally {
    closeTestDatabase(db);
  }
});
