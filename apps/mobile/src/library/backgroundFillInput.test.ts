import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import * as Effect from "effect/Effect";
import { loadLibraryStore } from "../../bench/fastAgain/store.ts";
import { openTestDatabase, closeTestDatabase, observeSqlTasks } from "./db/testDatabase.ts";
import { readBackgroundFillInput } from "./backgroundFillInput.ts";

const root = fileURLToPath(new URL("../../../../", import.meta.url));

test("background fill waits for a free turn before reading playlists", async () => {
  const db = await openTestDatabase();
  let stop: (() => void) | undefined;
  try {
    const store = await loadLibraryStore(root, db);
    Effect.runSync(
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
    const reading = Effect.runPromise(readBackgroundFillInput(store, turn));
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
