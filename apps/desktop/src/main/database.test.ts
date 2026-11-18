import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Database } from "@wave/client";
import { libraryCounts } from "@wave/client/db/counts";
import { addTrack, type TestDatabase } from "@wave/client/testing";
import * as Effect from "effect/Effect";
import { libraryLayer } from "./database.ts";

const withFolder = async (run: (folder: string) => Promise<void>): Promise<void> => {
  const folder = mkdtempSync(join(tmpdir(), "wave-desktop-"));
  try {
    await run(folder);
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
};

const inLibrary = <A>(file: string, use: (db: TestDatabase) => A): Promise<A> =>
  Effect.runPromise(
    Effect.gen(function* () {
      const db = yield* Database;
      return use(db as unknown as TestDatabase);
    }).pipe(Effect.provide(libraryLayer(file))),
  );

test("the desktop opens its Library file migrated and empty", async () => {
  await withFolder(async (folder) => {
    const file = join(folder, "wave.db");
    const counts = await inLibrary(file, libraryCounts);
    assert.equal(counts.songs, 0);
    assert.equal(counts.playlists, 0);
    assert.ok(existsSync(file));
  });
});

test("a Library opened again keeps its songs", async () => {
  await withFolder(async (folder) => {
    const file = join(folder, "wave.db");
    await inLibrary(file, (db) => {
      addTrack(db, { title: "Pink Moon", artist: "Nick Drake" });
      addTrack(db, { title: "Place to Be", artist: "Nick Drake" });
    });
    const counts = await inLibrary(file, libraryCounts);
    assert.equal(counts.songs, 2);
    assert.equal(counts.artists, 1);
  });
});
