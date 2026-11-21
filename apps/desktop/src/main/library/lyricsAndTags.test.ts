import assert from "node:assert/strict";
import { test } from "node:test";
import { openTestDatabase } from "@wave/client/testing";
import { sql } from "drizzle-orm";

import type { FixSongsRunOptions } from "./fixSongs.ts";
import type { FixSongsResult } from "../../shared/songActions.ts";
import { lookupsEnabled } from "../lookupSettings.ts";
import {
  artistPhotosEnabled,
  createLibraryFixRun,
  readLyricsAndTags,
  saveLyricsAndTags,
} from "./lyricsAndTags.ts";

/** A Library with the synced-settings table `database.ts` makes. */
const library = async () => {
  const db = await openTestDatabase();
  db.run(
    sql`CREATE TABLE IF NOT EXISTS desktop_synced_preferences (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
  );
  return db;
};

const stored = (db: Awaited<ReturnType<typeof library>>) =>
  Object.fromEntries(
    db
      .all<{ key: string; value: string }>(sql`SELECT key, value FROM desktop_synced_preferences`)
      .map(({ key, value }) => [key, value]),
  );

const stamps = (db: Awaited<ReturnType<typeof library>>) =>
  db
    .all<{ key: string; changed_at: number }>(
      sql`SELECT key, changed_at FROM preference_changes ORDER BY key`,
    )
    .map(({ key, changed_at }) => `${key}@${changed_at}`);

test("the switches are on in a Library with nothing stored", async () => {
  const db = await library();
  assert.deepEqual(readLyricsAndTags(db), {
    fixSongsOnline: true,
    downloadArtistPhotos: true,
    geniusInsights: true,
  });
  assert.equal(lookupsEnabled(db), true);
  assert.equal(artistPhotosEnabled(db), true);
});

test("a change is kept under the phone's keys in its format and stamped for sync", async () => {
  const db = await library();
  const after = saveLyricsAndTags(db, { fixSongsOnline: false, geniusInsights: false }, 1_000);
  assert.deepEqual(after, {
    fixSongsOnline: false,
    downloadArtistPhotos: true,
    geniusInsights: false,
  });
  assert.deepEqual(stored(db), {
    "settings.findLyricsAndGenre": "off",
    "settings.geniusInsights": "off",
  });
  assert.deepEqual(stamps(db), [
    "settings.findLyricsAndGenre@1000",
    "settings.geniusInsights@1000",
  ]);
  assert.equal(lookupsEnabled(db), false);

  saveLyricsAndTags(
    db,
    { fixSongsOnline: true, downloadArtistPhotos: false, geniusInsights: true },
    2_000,
  );
  assert.deepEqual(stored(db), { "settings.downloadArtistPhotos": "off" });
  assert.deepEqual(stamps(db), [
    "settings.downloadArtistPhotos@2000",
    "settings.findLyricsAndGenre@2000",
    "settings.geniusInsights@2000",
  ]);
  assert.equal(artistPhotosEnabled(db), false);
});

test("saving a switch at the value it has stamps nothing", async () => {
  const db = await library();
  saveLyricsAndTags(db, { fixSongsOnline: true, downloadArtistPhotos: true }, 1_000);
  assert.deepEqual(stamps(db), []);
});

test("Fix songs in the whole Library runs once on every song, telling its progress", async () => {
  const asked: (readonly number[])[] = [];
  let finish!: (result: FixSongsResult) => void;
  let options!: FixSongsRunOptions;
  const run = createLibraryFixRun({
    songs: () => [3, 1, 2],
    fix: (ids, given) => {
      asked.push(ids);
      options = given;
      return new Promise((resolve) => (finish = resolve));
    },
  });
  assert.equal(run.progress(), null);
  const started = run.start();
  assert.deepEqual(run.progress(), { done: 0, total: 0 });
  options.progress?.(1, 2);
  assert.deepEqual(run.progress(), { done: 1, total: 2 });
  assert.equal(run.start(), started, "a second start joins the run");
  const result: FixSongsResult = { results: [], skipped: 3 };
  finish(result);
  assert.equal(await started, result);
  assert.equal(run.progress(), null);
  assert.deepEqual(asked, [[3, 1, 2]]);
});

test("Cancel stops the run, and the next start runs afresh", async () => {
  let options!: FixSongsRunOptions;
  const run = createLibraryFixRun({
    songs: () => [1],
    fix: async (_ids, given) => {
      options = given;
      await new Promise<void>((resolve) =>
        given.signal?.addEventListener("abort", () => resolve()),
      );
      return { results: [], skipped: 0, stop: { stopped: "cancelled", left: 1 } };
    },
  });
  const started = run.start();
  run.cancel();
  assert.equal(options.signal?.aborted, true);
  assert.deepEqual((await started).stop, { stopped: "cancelled", left: 1 });
  assert.equal(run.progress(), null);
  const again = run.start();
  assert.notEqual(again, started);
  assert.equal(options.signal?.aborted, false);
  run.cancel();
  await again;
});

test("a run that fails ends, so the next can start", async () => {
  const run = createLibraryFixRun({
    songs: () => [1],
    fix: async () => {
      throw new Error("[lookups-off] Online lookups are off");
    },
  });
  await assert.rejects(run.start(), /lookups-off/);
  assert.equal(run.progress(), null);
});
