import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import type { MagicQueueSeed, PlayEvent, YtAlbumSong } from "@wave/core";
import * as Effect from "effect/Effect";

import { loadLibraryStore } from "../../bench/fastAgain/store.ts";
import {
  addMissingSong,
  addTrack,
  closeTestDatabase,
  openTestDatabase,
} from "@wave/client/testing";
import type { PlayableSongRow } from "@wave/client";
import { readMostListenedRecently } from "./mostListenedRecentlyRead.ts";

const root = fileURLToPath(new URL("../../../../", import.meta.url));

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 10, 20, 12);

/** What a tile shows: a Library song's id, or a streamed song's video id. */
const shown = (seeds: readonly MagicQueueSeed<PlayableSongRow>[]) =>
  seeds.map((seed) => (seed.source === "library" ? seed.song.id : seed.song.videoId));

const play = (trackId: number | string, startedAt: number, counted = true): PlayEvent => ({
  trackId: String(trackId),
  context: null,
  startedAt,
  listenedMs: counted ? 180_000 : 2_000,
  durationMs: 180_000,
  endReason: counted ? "completed" : "skipped",
  counted,
  source: "phone",
});

const streamedSong = (videoId: string, explicit = false): YtAlbumSong => ({
  videoId,
  title: `Streamed ${videoId}`,
  artists: ["Someone"],
  album: null,
  durationMs: 180_000,
  artworkUrl: null,
  explicit,
  albumId: null,
});

type Store = Awaited<ReturnType<typeof loadLibraryStore>>;

/** [times] counted plays of [song] (a Library id, or a streamed song), the latest at [at]. */
const listen = (store: Store, song: number | YtAlbumSong, times: number, at = NOW - DAY) => {
  for (let n = 0; n < times; n++)
    Effect.runSync(
      typeof song === "number"
        ? store.recordPlay(play(song, at - n), false)
        : store.recordPlay(play(`yt:${song.videoId}`, at - n), false, song),
    );
};

test("the page lists the songs with the most counted plays of the last 14 days, streamed ones included", async () => {
  const db = await openTestDatabase();
  try {
    const [a, b, old] = ["A", "B", "Old"].map((title) => addTrack(db, { title }));
    const store = await loadLibraryStore(root, db);
    const online = streamedSong("v-online");
    listen(store, a!, 2);
    listen(store, b!, 4);
    listen(store, online, 3);
    // Outside the window: its many plays started over 14 days ago.
    listen(store, old!, 9, NOW - 14 * DAY - 1);
    // A skip counts for nothing.
    Effect.runSync(store.recordPlay(play(a!, NOW - 5, false), false));
    assert.deepEqual(shown(Effect.runSync(readMostListenedRecently(store, NOW))), [
      b,
      "v-online",
      a,
    ]);
  } finally {
    closeTestDatabase(db);
  }
});

test("Don't play explicit skips explicit streamed songs and fills the page with the next clean song", async () => {
  const db = await openTestDatabase();
  try {
    const store = await loadLibraryStore(root, db);
    const explicit = streamedSong("v-explicit", true);
    const clean = streamedSong("v-clean");
    listen(store, explicit, 5);
    listen(store, clean, 4);
    const recent = [
      streamedSong("v-a"),
      streamedSong("v-b"),
      streamedSong("v-c"),
      streamedSong("v-d"),
    ];
    recent.forEach((song, index) => listen(store, song, 3 - Math.floor(index / 2)));
    assert.deepEqual(shown(Effect.runSync(readMostListenedRecently(store, NOW, true))), [
      "v-clean",
      "v-a",
      "v-b",
      "v-c",
      "v-d",
    ]);
  } finally {
    closeTestDatabase(db);
  }
});

test("a play started exactly 14 days ago still counts", async () => {
  const db = await openTestDatabase();
  try {
    const ids = ["A", "B", "C"].map((title) => addTrack(db, { title }));
    const store = await loadLibraryStore(root, db);
    for (const id of ids) listen(store, id, 1, NOW - 14 * DAY + ids.indexOf(id));
    assert.deepEqual(
      shown(Effect.runSync(readMostListenedRecently(store, NOW))).toSorted(),
      ids.toSorted(),
    );
    assert.deepEqual(shown(Effect.runSync(readMostListenedRecently(store, NOW + 1))), []);
  } finally {
    closeTestDatabase(db);
  }
});

test("fewer than three songs give no page", async () => {
  const db = await openTestDatabase();
  try {
    const ids = ["A", "B"].map((title) => addTrack(db, { title }));
    const store = await loadLibraryStore(root, db);
    assert.deepEqual(Effect.runSync(readMostListenedRecently(store, NOW)), []);
    for (const id of ids) listen(store, id, 5);
    assert.deepEqual(Effect.runSync(readMostListenedRecently(store, NOW)), []);
  } finally {
    closeTestDatabase(db);
  }
});

test("the page holds nine songs, passing over one without a file", async () => {
  const db = await openTestDatabase();
  try {
    const ids = Array.from({ length: 11 }, (_, i) => addTrack(db, { title: `Song ${i}` }));
    const missing = addMissingSong(db, { title: "Missing file" });
    const store = await loadLibraryStore(root, db);
    listen(store, missing, 20);
    ids.forEach((id, place) => listen(store, id, 11 - place));
    assert.deepEqual(shown(Effect.runSync(readMostListenedRecently(store, NOW))), ids.slice(0, 9));
  } finally {
    closeTestDatabase(db);
  }
});
