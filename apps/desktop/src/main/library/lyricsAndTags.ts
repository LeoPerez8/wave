/**
 * Settings › Lyrics and tags (docs/spec.md, Settings): Fix songs online and Download artist
 * photos, the account's synced switches kept under the phone's keys and in its formats
 * (`desktop_synced_preferences`), and Fix songs in the whole Library, run in the background with
 * its progress and Cancel. Genius isn't in desktop v1, so its switch isn't here.
 */
import { stampPreference } from "@wave/client/db/sync";
import type { LibraryDatabase } from "@wave/client/db/database";
import {
  DOWNLOAD_ARTIST_PHOTOS_SETTING,
  FIND_LYRICS_AND_GENRE_SETTING,
  readDownloadArtistPhotos,
  writeDownloadArtistPhotos,
  writeFindLyricsAndGenre,
} from "@wave/core";

import type { LyricsAndTagsSettings } from "../../shared/lyricsAndTags.ts";
import { lookupsEnabled } from "../lookupSettings.ts";
import { keepSyncedPreference, syncedPreference } from "../sync/desktopSync.ts";

/** Settings › Download artist photos, as the account holds it. */
export const artistPhotosEnabled = (db: LibraryDatabase): boolean =>
  readDownloadArtistPhotos(syncedPreference(db, DOWNLOAD_ARTIST_PHOTOS_SETTING));

export const readLyricsAndTags = (db: LibraryDatabase): LyricsAndTagsSettings => ({
  fixSongsOnline: lookupsEnabled(db),
  downloadArtistPhotos: artistPhotosEnabled(db),
});

/** Keeps the owner's [change] at [now] and stamps each switch that moved for sync. */
export const saveLyricsAndTags = (
  db: LibraryDatabase,
  change: Partial<LyricsAndTagsSettings>,
  now: number,
): LyricsAndTagsSettings => {
  const before = readLyricsAndTags(db);
  const after = { ...before, ...change };
  const writes = [
    [
      "fixSongsOnline",
      FIND_LYRICS_AND_GENRE_SETTING,
      writeFindLyricsAndGenre(after.fixSongsOnline),
    ],
    [
      "downloadArtistPhotos",
      DOWNLOAD_ARTIST_PHOTOS_SETTING,
      writeDownloadArtistPhotos(after.downloadArtistPhotos),
    ],
  ] as const;
  for (const [name, key, value] of writes) {
    if (after[name] === before[name]) continue;
    keepSyncedPreference(db, key, value);
    stampPreference(db, key, now);
  }
  return after;
};
