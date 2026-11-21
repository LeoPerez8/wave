import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import type { MagicQueueSeed, PlayEvent, TasteProfile, YtAlbumSong } from "@wave/core";
import { sql } from "drizzle-orm";
import * as Effect from "effect/Effect";

import { loadLibraryStore } from "../../bench/fastAgain/store.ts";
import {
  addMissingSong,
  addTrack,
  closeTestDatabase,
  openTestDatabase,
} from "@wave/client/testing";
import type { PlayableSongRow } from "@wave/client";
import { readDiscoveries } from "./discoveriesRead.ts";
import { readMixInputs } from "./mixInputs.ts";

const root = fileURLToPath(new URL("../../../../", import.meta.url));

const NOW = Date.UTC(2026, 10, 20, 12);

/** What a tile shows: a Library song's id, or a streamed song's video id. */
const shown = (seeds: readonly MagicQueueSeed<PlayableSongRow>[]) =>
  seeds.map((seed) => (seed.source === "library" ? seed.song.id : seed.song.videoId));

const play = (trackId: number | string, counted = true): PlayEvent => ({
  trackId: String(trackId),
  context: null,
  startedAt: NOW - 1_000,
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

/** Puts [songs] in the candidate catalog, as a radio of [seed] brings them. */
const keep = (store: Store, songs: readonly YtAlbumSong[], seed = "Seed") =>
  Effect.runSync(store.addCandidates({ songs, seed }, NOW - 5_000));

/** The page, read from [store] alone. */
const page = (
  store: Store,
  options: { readonly taste?: TasteProfile | null; readonly dontPlayExplicit?: boolean } = {},
) =>
  Effect.runSync(
    Effect.gen(function* () {
      return yield* readDiscoveries(store, {
        now: NOW,
        library: yield* readMixInputs(store, Effect.void, NOW),
        catalog: yield* store.candidateCatalog,
        taste: options.taste ?? null,
        profileOf: () => null,
        dontPlayExplicit: options.dontPlayExplicit ?? false,
        turn: Effect.void,
      });
    }),
  );

test("the page lists catalog songs never played, then the Library's unplayed songs", async () => {
  const db = await openTestDatabase();
  try {
    const [a, b] = ["A", "B"].map((title) => addTrack(db, { title }));
    const store = await loadLibraryStore(root, db);
    keep(store, [streamedSong("v1"), streamedSong("v2")]);
    assert.deepEqual(shown(page(store)).slice(0, 2).toSorted(), ["v1", "v2"]);
    assert.deepEqual(shown(page(store)).slice(2).toSorted(), [a, b].toSorted());
  } finally {
    closeTestDatabase(db);
  }
});

test("a song leaves the page once it has a counted play", async () => {
  const db = await openTestDatabase();
  try {
    const ids = ["A", "B", "C"].map((title) => addTrack(db, { title }));
    const store = await loadLibraryStore(root, db);
    const [v1, v2] = [streamedSong("v1"), streamedSong("v2")];
    keep(store, [v1!, v2!]);
    // A skip is no counted play: the songs stay.
    Effect.runSync(store.recordPlay(play(ids[0]!, false), false));
    Effect.runSync(store.recordPlay(play("yt:v1", false), false, v1));
    assert.equal(page(store).length, 5);
    Effect.runSync(store.recordPlay(play(ids[0]!), false));
    Effect.runSync(store.recordPlay(play("yt:v1"), false, v1));
    assert.deepEqual(
      shown(page(store)).map(String).toSorted(),
      ["v2", ids[1], ids[2]].map(String).toSorted(),
    );
  } finally {
    closeTestDatabase(db);
  }
});

test("fewer than three unplayed songs give no page", async () => {
  const db = await openTestDatabase();
  try {
    addTrack(db, { title: "A" });
    const store = await loadLibraryStore(root, db);
    assert.deepEqual(page(store), []);
    keep(store, [streamedSong("v1")]);
    assert.deepEqual(page(store), []);
    keep(store, [streamedSong("v2")]);
    assert.equal(page(store).length, 3);
  } finally {
    closeTestDatabase(db);
  }
});

test("the page holds nine songs and passes over a Library song without a file", async () => {
  const db = await openTestDatabase();
  try {
    const ids = Array.from({ length: 4 }, (_, i) => addTrack(db, { title: `Song ${i}` }));
    const missing = addMissingSong(db, { title: "Missing file" });
    const store = await loadLibraryStore(root, db);
    keep(
      store,
      Array.from({ length: 7 }, (_, i) => streamedSong(`v${i}`)),
    );
    const songs = shown(page(store));
    assert.equal(songs.length, 9);
    assert.equal(songs.filter((song) => typeof song === "string").length, 7);
    assert.equal(songs.includes(missing), false);
    assert.equal(
      songs.filter((song) => typeof song === "number").every((id) => ids.includes(id)),
      true,
    );
  } finally {
    closeTestDatabase(db);
  }
});

test("a catalog song the Library has a file of shows as the Library song, once", async () => {
  const db = await openTestDatabase();
  try {
    const owned = addTrack(db, { title: "Downloaded" });
    db.run(sql`UPDATE tracks SET video_id = 'v-owned' WHERE id = ${owned}`);
    const store = await loadLibraryStore(root, db);
    keep(store, [streamedSong("v-owned"), streamedSong("v1"), streamedSong("v2")]);
    assert.deepEqual(
      shown(page(store)).map(String).toSorted(),
      ["v1", "v2", String(owned)].toSorted(),
    );
  } finally {
    closeTestDatabase(db);
  }
});

test("explicit catalog songs stay out while Don't play explicit is on", async () => {
  const db = await openTestDatabase();
  try {
    const store = await loadLibraryStore(root, db);
    keep(store, [
      streamedSong("clean1"),
      streamedSong("clean2"),
      streamedSong("clean3"),
      streamedSong("explicit", true),
    ]);
    assert.equal(shown(page(store)).includes("explicit"), true);
    assert.deepEqual(shown(page(store, { dontPlayExplicit: true })).toSorted(), [
      "clean1",
      "clean2",
      "clean3",
    ]);
  } finally {
    closeTestDatabase(db);
  }
});
