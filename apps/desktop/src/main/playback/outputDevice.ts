/**
 * The output Wave plays on (Settings › Playback): the system's default unless the owner picked
 * another. The choice belongs to this computer, so it is kept with the desktop's own settings
 * and never synced. It stays while its device is away: the engine plays on the system's default
 * until the device is back.
 */
import type { LibraryDatabase } from "@wave/client/db/database";
import { sql } from "drizzle-orm";

import type { OutputDevice } from "../../shared/playback.ts";
import type { OutputSettings } from "../../shared/playbackSettings.ts";
import { preference, savePreference } from "../preferences.ts";

const KEY = "outputDevice";

/** The output picked, with the name it had then; `undefined` for the system's default. */
export const readOutput = (db: LibraryDatabase): OutputDevice | undefined => {
  try {
    const kept: unknown = JSON.parse(preference(db, KEY) ?? "null");
    if (typeof kept !== "object" || kept === null) return undefined;
    const { id, name } = kept as Record<string, unknown>;
    return typeof id === "string" && id !== "" && typeof name === "string"
      ? { id, name }
      : undefined;
  } catch {
    return undefined;
  }
};

/** Keeps [output] as the one picked; `undefined` goes back to the system's default. */
export const saveOutput = (db: LibraryDatabase, output: OutputDevice | undefined): void => {
  if (output === undefined) db.run(sql`DELETE FROM desktop_settings WHERE key = ${KEY}`);
  else savePreference(db, KEY, JSON.stringify({ id: output.id, name: output.name }));
};

/** What Settings › Playback shows: the system's [outputs] and the one [picked], here or away. */
export const outputSettings = (
  outputs: readonly OutputDevice[],
  picked: OutputDevice | undefined,
): OutputSettings => {
  if (picked === undefined) return { outputs, chosen: null };
  const here = outputs.find((output) => output.id === picked.id);
  return { outputs, chosen: { ...(here ?? picked), connected: here !== undefined } };
};
