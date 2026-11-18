import assert from "node:assert/strict";
import { test } from "node:test";
import { openTestDatabase } from "@wave/client/testing";
import { sql } from "drizzle-orm";

import { lookupsEnabled } from "../lookupSettings.ts";
import {
  artistPhotosEnabled,
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

test("both switches are on in a Library with nothing stored", async () => {
  const db = await library();
  assert.deepEqual(readLyricsAndTags(db), { fixSongsOnline: true, downloadArtistPhotos: true });
  assert.equal(lookupsEnabled(db), true);
  assert.equal(artistPhotosEnabled(db), true);
});

test("a change is kept under the phone's keys in its format and stamped for sync", async () => {
  const db = await library();
  const after = saveLyricsAndTags(db, { fixSongsOnline: false }, 1_000);
  assert.deepEqual(after, { fixSongsOnline: false, downloadArtistPhotos: true });
  assert.deepEqual(stored(db), { "settings.findLyricsAndGenre": "off" });
  assert.deepEqual(stamps(db), ["settings.findLyricsAndGenre@1000"]);
  assert.equal(lookupsEnabled(db), false);

  saveLyricsAndTags(db, { fixSongsOnline: true, downloadArtistPhotos: false }, 2_000);
  assert.deepEqual(stored(db), { "settings.downloadArtistPhotos": "off" });
  assert.deepEqual(stamps(db), [
    "settings.downloadArtistPhotos@2000",
    "settings.findLyricsAndGenre@2000",
  ]);
  assert.equal(artistPhotosEnabled(db), false);
});

test("saving a switch at the value it has stamps nothing", async () => {
  const db = await library();
  saveLyricsAndTags(db, { fixSongsOnline: true, downloadArtistPhotos: true }, 1_000);
  assert.deepEqual(stamps(db), []);
});
