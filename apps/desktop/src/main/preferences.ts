import { sql } from "drizzle-orm";
import type { LibraryDatabase } from "@wave/client/db/database";
import type { Appearance } from "../shared/bridge.ts";

/** Device-local desktop settings; shared/synced preferences keep their existing schema. */
export const preference = (db: LibraryDatabase, key: string): string | undefined =>
  db.get<{ value: string }>(sql`SELECT value FROM desktop_settings WHERE key=${key}`)?.value;
export const savePreference = (db: LibraryDatabase, key: string, value: string): void => {
  db.run(
    sql`INSERT INTO desktop_settings(key,value) VALUES(${key},${value}) ON CONFLICT(key) DO UPDATE SET value=excluded.value`,
  );
};
export const appearance = (db: LibraryDatabase): Appearance => {
  const value = preference(db, "appearance");
  return value === "light" || value === "dark" ? value : "system";
};
