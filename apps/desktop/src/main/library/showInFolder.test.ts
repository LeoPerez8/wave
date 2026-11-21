import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Database } from "@wave/client";
import { addTrack, type TestDatabase } from "@wave/client/testing";
import type { LibraryDatabase } from "@wave/client/db/database";
import { sql } from "drizzle-orm";
import * as Effect from "effect/Effect";
import * as ManagedRuntime from "effect/ManagedRuntime";
import { libraryLayer } from "../database.ts";
import { showSongInFolder } from "./showInFolder.ts";

const withLibrary = async (run: (db: LibraryDatabase, folder: string) => void) => {
  const folder = mkdtempSync(join(tmpdir(), "wave-show-in-folder-"));
  const runtime = ManagedRuntime.make(libraryLayer(join(folder, "wave.db")));
  try {
    run(
      (await runtime.runPromise(
        Effect.gen(function* () {
          return yield* Database;
        }),
      )) as unknown as LibraryDatabase,
      folder,
    );
  } finally {
    await runtime.dispose();
    rmSync(folder, { recursive: true, force: true });
  }
};

test("Show in Folder opens the file manager on the song's own file, found by its id", async () => {
  await withLibrary((db, folder) => {
    const id = addTrack(db as unknown as TestDatabase, { title: "Road", artist: "Nick Drake" });
    const path = join(folder, "Road.wav");
    writeFileSync(path, "");
    db.run(sql`UPDATE tracks SET path=${path} WHERE id=${id}`);
    const shown: string[] = [];
    const ports = { db, unavailable: () => false, show: (file: string) => shown.push(file) };
    assert.equal(showSongInFolder(ports, id), "shown");
    assert.deepEqual(shown, [path]);
  });
});

test("Show in Folder says the drive isn't connected, or the file is gone, and opens nothing", async () => {
  await withLibrary((db, folder) => {
    const id = addTrack(db as unknown as TestDatabase, { title: "Road", artist: "Nick Drake" });
    const path = join(folder, "Drive", "Road.wav");
    db.run(sql`UPDATE tracks SET path=${path} WHERE id=${id}`);
    const shown: string[] = [];
    const show = (file: string) => shown.push(file);
    assert.equal(showSongInFolder({ db, unavailable: (p) => p === path, show }, id), "unavailable");
    assert.equal(showSongInFolder({ db, unavailable: () => false, show }, id), "gone");
    // A missing song has no file, and a song that isn't the Library's isn't anyone's.
    const missing = addTrack(db as unknown as TestDatabase, { title: "Pink Moon", artist: "Nick" });
    db.run(sql`UPDATE tracks SET path=NULL WHERE id=${missing}`);
    assert.equal(showSongInFolder({ db, unavailable: () => false, show }, missing), "gone");
    assert.throws(() => showSongInFolder({ db, unavailable: () => false, show }, 9_999));
    assert.deepEqual(shown, []);
  });
});
