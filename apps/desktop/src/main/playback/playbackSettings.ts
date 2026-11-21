/**
 * Settings › Playback (docs/spec.md, stories 22a–22c): Crossfade, Normalize Volume, Buffer,
 * Don't Play Explicit and Continue with Magic Queue.
 * They are the account-wide synced settings, stored under the phone's keys and in the phone's
 * formats with the account's synced values (`desktop_synced_preferences`, which sync pulls
 * into), so a signed-in desktop plays by the values the phone shows. An owner's change is
 * stamped (`stampPreference`) for sync to push.
 */
import {
  DONT_PLAY_EXPLICIT_SETTING,
  readContinueQueue,
  readCrossfade,
  readDontPlayExplicit,
  readNormalizeVolume,
  readShuffleKind,
  readStreamBuffer,
  snapCrossfade,
  STREAM_BUFFER_DEFAULT,
  writeContinueQueue,
  writeDontPlayExplicit,
  writeNormalizeVolume,
  writeShuffleKind,
  type StreamBufferMinutes,
} from "@wave/core";
import type { LibraryDatabase } from "@wave/client/db/database";
import { stampPreference } from "@wave/client/db/sync";
import { sql } from "drizzle-orm";

import type { PlaybackSettings } from "../../shared/playbackSettings.ts";

/** The phone's keys for the settings. */
export const PLAYBACK_SETTING_KEYS = {
  crossfadeSeconds: "settings.crossfadeSeconds",
  normalizeVolume: "settings.normalizeVolume",
  bufferMinutes: "settings.streamBufferMinutes",
  shuffleKind: "settings.shuffleKind",
  dontPlayExplicit: DONT_PLAY_EXPLICIT_SETTING,
  continueQueue: "settings.continueQueue",
} as const;

/** Whether a pull that changed the synced settings [keys] changed Settings › Playback. */
export const changesPlaybackSettings = (keys: readonly string[]): boolean => {
  const playback: readonly string[] = Object.values(PLAYBACK_SETTING_KEYS);
  return keys.some((key) => playback.includes(key));
};

const stored = (db: LibraryDatabase, key: string): string | null =>
  db.get<{ value: string }>(sql`SELECT value FROM desktop_synced_preferences WHERE key = ${key}`)
    ?.value ?? null;

const keep = (db: LibraryDatabase, key: string, value: string | null): void => {
  if (value === null) db.run(sql`DELETE FROM desktop_synced_preferences WHERE key = ${key}`);
  else
    db.run(
      sql`INSERT INTO desktop_synced_preferences (key, value) VALUES (${key}, ${value})
        ON CONFLICT (key) DO UPDATE SET value = excluded.value`,
    );
};

/** The settings as stored, each read by Core's rules (a Crossfade out of range is clamped). */
export const readPlaybackSettings = (db: LibraryDatabase): PlaybackSettings => ({
  crossfadeSeconds: readCrossfade(stored(db, PLAYBACK_SETTING_KEYS.crossfadeSeconds)),
  normalizeVolume: readNormalizeVolume(stored(db, PLAYBACK_SETTING_KEYS.normalizeVolume)),
  bufferMinutes: readStreamBuffer(stored(db, PLAYBACK_SETTING_KEYS.bufferMinutes)),
  shuffleKind: readShuffleKind(stored(db, PLAYBACK_SETTING_KEYS.shuffleKind)),
  dontPlayExplicit: readDontPlayExplicit(stored(db, PLAYBACK_SETTING_KEYS.dontPlayExplicit)),
  continueQueue: readContinueQueue(stored(db, PLAYBACK_SETTING_KEYS.continueQueue)),
});

const writeBuffer = (minutes: StreamBufferMinutes): string | null =>
  minutes === STREAM_BUFFER_DEFAULT ? null : String(minutes);

/**
 * Keeps the owner's [change] at [now], in the phone's formats, and stamps each setting that
 * changed for sync. Answers the settings after it.
 */
export const savePlaybackSettings = (
  db: LibraryDatabase,
  change: Partial<PlaybackSettings>,
  now: number,
): PlaybackSettings => {
  const before = readPlaybackSettings(db);
  const after: PlaybackSettings = {
    crossfadeSeconds: snapCrossfade(change.crossfadeSeconds ?? before.crossfadeSeconds),
    normalizeVolume: change.normalizeVolume ?? before.normalizeVolume,
    bufferMinutes: readStreamBuffer(String(change.bufferMinutes ?? before.bufferMinutes)),
    shuffleKind: change.shuffleKind ?? before.shuffleKind,
    dontPlayExplicit: change.dontPlayExplicit ?? before.dontPlayExplicit,
    continueQueue: change.continueQueue ?? before.continueQueue,
  };
  const writes: [keyof PlaybackSettings, string | null][] = [
    ["crossfadeSeconds", String(after.crossfadeSeconds)],
    ["normalizeVolume", writeNormalizeVolume(after.normalizeVolume)],
    ["bufferMinutes", writeBuffer(after.bufferMinutes)],
    ["shuffleKind", writeShuffleKind(after.shuffleKind)],
    ["dontPlayExplicit", writeDontPlayExplicit(after.dontPlayExplicit)],
    ["continueQueue", writeContinueQueue(after.continueQueue)],
  ];
  for (const [name, value] of writes) {
    if (after[name] === before[name]) continue;
    keep(db, PLAYBACK_SETTING_KEYS[name], value);
    stampPreference(db, PLAYBACK_SETTING_KEYS[name], now);
  }
  return after;
};
