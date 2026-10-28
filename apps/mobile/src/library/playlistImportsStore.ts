/**
 * The link imports as kept on the phone ("playlistImports", never synced;
 * Core's `writePlaylistImports`, `readPlaylistImports`): those giving their
 * playlist its songs, and those done with songs left out to show. Its own
 * module so the batch's line (`importProgress.ts`) reads it without the
 * imports' runner (`playlistImports.ts`).
 */
import {
  readPlaylistImports,
  writePlaylistImports,
  type PlaylistImports,
  type YtAlbumSong,
} from "@wave/core";

import { persistedSetting } from "@/lib/persistedSetting";

/** The imports giving their playlist its songs, or done with songs left out to show, kept until Wave starts again. */
export const playlistImports = persistedSetting<PlaylistImports<YtAlbumSong>>({
  key: "playlistImports",
  read: readPlaylistImports,
  write: (value) => (value.length === 0 ? null : writePlaylistImports(value)),
});
