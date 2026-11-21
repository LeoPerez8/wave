/**
 * The desktop shows and plays a collaborative playlist and edits none of it, for the owner and
 * for the other members (docs/spec-desktop.md, Wave account and sync): every window call that
 * would change its name, entries or order asks here first. Its image stays this device's own.
 */
import type { LibraryDatabase } from "@wave/client/db/database";
import { sql } from "drizzle-orm";

/** The playlist [playlistId] is collaborative: the account's pull said so. */
export const isCollaborative = (db: LibraryDatabase, playlistId: number): boolean =>
  // A count, as a row that isn't there can read back as an empty object.
  (db.get<{ n: number }>(
    sql`SELECT COUNT(*) AS n FROM playlists p JOIN collaborations c ON c.playlist_sync_id = p.sync_id
      WHERE p.id = ${playlistId}`,
  )?.n ?? 0) > 0;

/** Throws, changing nothing, when [playlistId] is collaborative. */
export const refuseCollaborative = (db: LibraryDatabase, playlistId: number): void => {
  if (isCollaborative(db, playlistId))
    throw new Error("The desktop doesn't edit a collaborative playlist");
};
