import assert from "node:assert/strict";
import { test } from "node:test";
import { openTestDatabase } from "@wave/client/testing";
import { sql } from "drizzle-orm";

import {
  changesPlaybackSettings,
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
    shuffleKind: "real",
    dontPlayExplicit: false,
    continueQueue: true,
  });
});

test("a change is kept in the phone's formats and stamped for sync, setting by setting", async () => {
  const db = await library();
  const after = savePlaybackSettings(db, { crossfadeSeconds: 6.3, normalizeVolume: false }, 1_000);
  assert.deepEqual(after, {
    crossfadeSeconds: 6.5,
    normalizeVolume: false,
    bufferMinutes: 2,
    shuffleKind: "real",
    dontPlayExplicit: false,
    continueQueue: true,
  });
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
    shuffleKind: "real",
    dontPlayExplicit: false,
    continueQueue: true,
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
    shuffleKind: "real",
    dontPlayExplicit: false,
    continueQueue: true,
  });
});

test("Don't Play Explicit and Continue with Magic Queue are kept as the phone keeps them, and stamped", async () => {
  const db = await library();
  savePlaybackSettings(db, { dontPlayExplicit: true, continueQueue: false }, 1_000);
  assert.deepEqual(stored(db), {
    "settings.dontPlayExplicit": "on",
    "settings.continueQueue": "off",
  });
  assert.deepEqual(stamps(db), ["settings.continueQueue@1000", "settings.dontPlayExplicit@1000"]);
  const { dontPlayExplicit, continueQueue } = readPlaybackSettings(db);
  assert.deepEqual(
    { dontPlayExplicit, continueQueue },
    { dontPlayExplicit: true, continueQueue: false },
  );

  // Back at their defaults, nothing is stored, as on the phone.
  savePlaybackSettings(db, { dontPlayExplicit: false, continueQueue: true }, 2_000);
  assert.deepEqual(stored(db), {});
  assert.deepEqual(stamps(db), ["settings.continueQueue@2000", "settings.dontPlayExplicit@2000"]);
});

test("a pull changed Settings › Playback only when it brought one of its keys", () => {
  assert.equal(changesPlaybackSettings(["settings.theme", "settings.crossfadeSeconds"]), true);
  assert.equal(changesPlaybackSettings(["settings.streamBufferMinutes"]), true);
  assert.equal(changesPlaybackSettings(["settings.dontPlayExplicit"]), true);
  assert.equal(changesPlaybackSettings(["settings.continueQueue"]), true);
  assert.equal(changesPlaybackSettings(["settings.theme", "settings.tabBar"]), false);
  assert.equal(changesPlaybackSettings([]), false);
});

test("the kind of shuffle is the phone's synced setting: kept under its key, Real Shuffle as nothing", async () => {
  const db = await library();
  assert.equal(savePlaybackSettings(db, { shuffleKind: "smart" }, 1_000).shuffleKind, "smart");
  assert.deepEqual(stored(db), { "settings.shuffleKind": "smart" });
  assert.deepEqual(stamps(db), ["settings.shuffleKind@1000"]);
  assert.equal(readPlaybackSettings(db).shuffleKind, "smart");
  assert.equal(changesPlaybackSettings(["settings.shuffleKind"]), true);

  savePlaybackSettings(db, { shuffleKind: "real" }, 2_000);
  assert.deepEqual(stored(db), {});
  assert.deepEqual(stamps(db), ["settings.shuffleKind@2000"]);
  db.run(
    sql`INSERT INTO desktop_synced_preferences (key, value) VALUES ('settings.shuffleKind', 'even')`,
  );
  assert.equal(readPlaybackSettings(db).shuffleKind, "even");
});
