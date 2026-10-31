import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import type { PlaylistSong } from "@wave/core";
import * as Effect from "effect/Effect";

import { loadLibraryStore } from "../../bench/fastAgain/store.ts";
import { closeTestDatabase, openTestDatabase, traceQueries } from "../library/db/testDatabase.ts";
import { createPlaylistSeedIdsRead, readPlaylistSeedIds } from "./playlistSeedIds.ts";

const root = fileURLToPath(new URL("../../../../", import.meta.url));

const streamed = (videoId: string): PlaylistSong => ({
  source: "stream",
  song: {
    videoId,
    title: videoId,
    artists: ["Someone"],
    album: null,
    durationMs: 200_000,
    artworkUrl: null,
    explicit: false,
  },
});

test("Home's returns read no entries; a playlist or track change reads them again", async () => {
  const db = await openTestDatabase();
  try {
    const store = await loadLibraryStore(root, db);
    await Effect.runPromise(store.createPlaylist("Liked Songs", [streamed("a"), streamed("b")]));
    let reads = 0;
    const seedIds = createPlaylistSeedIdsRead(
      Effect.suspend(() => {
        reads++;
        return readPlaylistSeedIds(store, Effect.void);
      }),
    );
    assert.deepEqual(await Effect.runPromise(seedIds.get), ["a", "b"]);
    assert.deepEqual(await Effect.runPromise(seedIds.get), ["a", "b"]);
    seedIds.change({ kind: "favorites" });
    seedIds.change({ kind: "plays" });
    assert.deepEqual(await Effect.runPromise(seedIds.get), ["a", "b"]);
    assert.equal(reads, 1);
    await Effect.runPromise(store.createPlaylist("Road trip", [streamed("c")]));
    seedIds.change({ kind: "playlists" });
    assert.deepEqual(await Effect.runPromise(seedIds.get), ["a", "b", "c"]);
    seedIds.change({ kind: "tracks" });
    await Effect.runPromise(seedIds.get);
    assert.equal(reads, 3);
    seedIds.dispose();
  } finally {
    closeTestDatabase(db);
  }
});

test("each page holds at most 512 rows whatever the entries are, with a turn between pages", async () => {
  const db = await openTestDatabase();
  try {
    const store = await loadLibraryStore(root, db);
    await Effect.runPromise(
      store.createPlaylist(
        "Long",
        Array.from({ length: 1_200 }, (_, i) => streamed(`v${i}`)),
      ),
    );
    let turns = 0;
    const measured = traceQueries(db, () =>
      Effect.runSync(
        readPlaylistSeedIds(
          store,
          Effect.sync(() => {
            turns++;
          }),
        ),
      ),
    );
    assert.equal(measured.result.length, 1_200);
    assert.ok(measured.queries.every((query) => query.rows <= 512));
    assert.equal(turns, 3);
  } finally {
    closeTestDatabase(db);
  }
});
