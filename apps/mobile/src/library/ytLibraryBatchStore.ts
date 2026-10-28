/**
 * From YT Music's and From Spotify's batch as kept on the phone ("ytLibraryBatch",
 * never synced; Core's `writeYtLibraryBatch`, `readYtLibraryBatch`): the
 * playlists still to be read, each with its expected count, and those whose
 * read failed. Its own module so the progress lines (`importProgress.ts`)
 * read it without the batch's runner (`ytLibraryImport.ts`).
 */
import { readYtLibraryBatch, writeYtLibraryBatch, type YtLibraryBatch } from "@wave/core";

import { persistedSetting } from "@/lib/persistedSetting";

export const ytLibraryBatch = persistedSetting<YtLibraryBatch>({
  key: "ytLibraryBatch",
  read: readYtLibraryBatch,
  write: writeYtLibraryBatch,
});
