import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import * as Effect from "effect/Effect";
import { runTestPromise, runTestSync } from "../lib/steppedTesting.ts";
import { loadLibraryStore } from "../../bench/fastAgain/store.ts";
import { openTestDatabase, closeTestDatabase, observeSqlTasks } from "@wave/client/testing";
import { readBackgroundFillInput } from "./backgroundFillInput.ts";

const root = fileURLToPath(new URL("../../../../", import.meta.url));

test("background fill waits for a free turn before reading playlists", async () => {
  const db = await openTestDatabase();
  let stop: (() => void) | undefined;
  try {
    const store = await loadLibraryStore(root, db);
    runTestSync(
      store.createPlaylist("Fill", [
        {
          source: "unsearched",
          song: {
            title: "Touch",
            artists: ["Daft Punk"],
            album: null,
            durationMs: 180000,
            artworkUrl: null,
          },
        },
      ]),
    );
    const queries: string[] = [];
    stop = observeSqlTasks(db, (sql) => queries.push(sql));
    let release: (() => void) | undefined;
    const turn = Effect.callback<void>((resume) => {
      release = () => resume(Effect.void);
    });
    const reading = runTestPromise(readBackgroundFillInput(store, turn, Effect.void));
    for (let i = 0; i < 10; i++) await Promise.resolve();
    assert.deepEqual(queries, []);
    assert.ok(release);
    release();
    const result = await reading;
    assert.deepEqual(
      result.entries.playlists().map((p) => p.songs.map((s) => s.title)),
      [["Touch"]],
    );
    assert.equal(queries.length, 2);
  } finally {
    stop?.();
    closeTestDatabase(db);
  }
});

test("background fill indexes a long read in slices, each after a free turn (#1453)", async () => {
  const db = await openTestDatabase();
  try {
    const store = await loadLibraryStore(root, db);
    const count = 1500;
    runTestSync(
      store.createPlaylist(
        "Long fill",
        Array.from({ length: count }, (_, n) => ({
          source: "unsearched" as const,
          song: {
            title: `Song ${n}`,
            artists: ["Daft Punk"],
            album: null,
            durationMs: 180000 + n,
            artworkUrl: null,
          },
        })),
      ),
    );
    let reads = 0;
    let slices = 0;
    const result = await runTestPromise(
      readBackgroundFillInput(
        store,
        Effect.sync(() => reads++),
        Effect.sync(() => slices++),
      ),
    );
    assert.equal(reads, 1, "one free turn before the read");
    assert.ok(slices >= 3, `${count} songs indexed in ${slices} slices`);
    assert.equal(result.entries.playlists()[0]?.songs.length, count);
  } finally {
    closeTestDatabase(db);
  }
});
