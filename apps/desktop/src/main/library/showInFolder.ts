/**
 * Show in Folder (docs/spec-desktop.md, the song menu): the window names a song by its id, never
 * a path; main reads the song's file from the index and checks it before the file manager opens.
 */
import { existsSync } from "node:fs";
import { isAbsolute, normalize } from "node:path";
import type { LibraryDatabase } from "@wave/client/db/database";
import { sql } from "drizzle-orm";
import type { ShowInFolderResult } from "../../shared/songActions.ts";

export interface ShowInFolderPorts {
  readonly db: LibraryDatabase;
  /** Whether [path] is in a music folder whose drive isn't connected. */
  readonly unavailable: (path: string) => boolean;
  /** Opens the system's file manager with [path] selected (Electron's `shell.showItemInFolder`). */
  readonly show: (path: string) => void;
  /** Whether the file is there; the disk's by default. */
  readonly exists?: (path: string) => boolean;
}

/**
 * Opens the file manager on the Library song [trackId]'s file: `unavailable` when its drive isn't
 * connected, `gone` when it has no file here (a missing song, a file moved or deleted).
 */
export const showSongInFolder = (
  { db, unavailable, show, exists = existsSync }: ShowInFolderPorts,
  trackId: number,
): ShowInFolderResult => {
  const song = db.get<{ path: string | null }>(sql`SELECT path FROM tracks WHERE id = ${trackId}`);
  if (song === undefined) throw new Error("Show in Folder takes a Library song");
  const { path } = song;
  if (path === null || !isAbsolute(path)) return "gone";
  if (unavailable(path)) return "unavailable";
  const file = normalize(path);
  if (!exists(file)) return "gone";
  show(file);
  return "shown";
};
