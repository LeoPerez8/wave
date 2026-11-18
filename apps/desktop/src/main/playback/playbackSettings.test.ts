import assert from "node:assert/strict";
import { test } from "node:test";
import { openTestDatabase } from "@wave/client/testing";
import { sql } from "drizzle-orm";

import {
  PLAYBACK_SETTING_KEYS,
  readPlaybackSettings,
  savePlaybackSettings,
} from "./playbackSettings.ts";

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

test("a Library with no settings plays by the phone's defaults", async () => {
  const db = await library();
  assert.deepEqual(readPlaybackSettings(db), {
    crossfadeSeconds: 0,
    normalizeVolume: true,
    bufferMinutes: 2,
  });
});

test("a change is kept in the phone's formats and stamped for sync, setting by setting", async () => {
  const db = await library();
  const after = savePlaybackSettings(db, { crossfadeSeconds: 6.3, normalizeVolume: false }, 1_000);
  assert.deepEqual(after, { crossfadeSeconds: 6.5, normalizeVolume: false, bufferMinutes: 2 });
  assert.deepEqual(stored(db), {
    [PLAYBACK_SETTING_KEYS.crossfadeSeconds]: "6.5",
    [PLAYBACK_SETTING_KEYS.normalizeVolume]: "off",
  });
  assert.deepEqual(stamps(db), ["settings.crossfadeSeconds@1000", "settings.normalizeVolume@1000"]);

  savePlaybackSettings(db, { normalizeVolume: true, bufferMinutes: 10 }, 2_000);
  assert.deepEqual(stored(db), {
    [PLAYBACK_SETTING_KEYS.crossfadeSeconds]: "6.5",
    [PLAYBACK_SETTING_KEYS.bufferMinutes]: "10",
  });
  assert.deepEqual(stamps(db), [
    "settings.crossfadeSeconds@1000",
    "settings.normalizeVolume@2000",
    "settings.streamBufferMinutes@2000",
  ]);
  assert.deepEqual(readPlaybackSettings(db), {
    crossfadeSeconds: 6.5,
    normalizeVolume: true,
    bufferMinutes: 10,
  });
});

test("the account's values, as sync pulls them, are read by Core's rules (a Crossfade past the range is clamped)", async () => {
  const db = await library();
  db.run(
    sql`INSERT INTO desktop_synced_preferences (key, value) VALUES
      ('settings.crossfadeSeconds', '99'), ('settings.streamBufferMinutes', '30')`,
  );
  assert.deepEqual(readPlaybackSettings(db), {
    crossfadeSeconds: 15,
    normalizeVolume: true,
    bufferMinutes: 30,
  });
});
