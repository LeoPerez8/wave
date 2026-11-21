/**
 * Settings › Lyrics and tags (docs/spec.md, Settings): Fix songs online and Download artist
 * photos, the account's synced switches kept under the phone's keys and in its formats
 * (`desktop_synced_preferences`), and Fix songs in the whole Library, run in the background with
 * its progress and Cancel. Genius insights is also shared with the phone.
 */
import { stampPreference } from "@wave/client/db/sync";
import type { LibraryDatabase } from "@wave/client/db/database";
import {
  DOWNLOAD_ARTIST_PHOTOS_SETTING,
  FIND_LYRICS_AND_GENRE_SETTING,
  GENIUS_INSIGHTS_SETTING,
  readDownloadArtistPhotos,
  readGeniusInsights,
  writeDownloadArtistPhotos,
  writeFindLyricsAndGenre,
  writeGeniusInsights,
} from "@wave/core";

import type { LibraryFixProgress, LyricsAndTagsSettings } from "../../shared/lyricsAndTags.ts";
import type { FixSongsResult } from "../../shared/songActions.ts";
import type { FixSongsRunOptions } from "./fixSongs.ts";
import { lookupsEnabled } from "../lookupSettings.ts";
import { keepPreference, syncedPreference } from "../sync/desktopSync.ts";

/** Settings › Download artist photos, as the account holds it. */
export const artistPhotosEnabled = (db: LibraryDatabase): boolean =>
  readDownloadArtistPhotos(syncedPreference(db, DOWNLOAD_ARTIST_PHOTOS_SETTING));

export const geniusInsightsEnabled = (db: LibraryDatabase): boolean =>
  readGeniusInsights(syncedPreference(db, GENIUS_INSIGHTS_SETTING));

export const readLyricsAndTags = (db: LibraryDatabase): LyricsAndTagsSettings => ({
  fixSongsOnline: lookupsEnabled(db),
  downloadArtistPhotos: artistPhotosEnabled(db),
  geniusInsights: geniusInsightsEnabled(db),
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
    ["geniusInsights", GENIUS_INSIGHTS_SETTING, writeGeniusInsights(after.geniusInsights)],
  ] as const;
  for (const [name, key, value] of writes) {
    if (after[name] === before[name]) continue;
    keepPreference(db, key, value);
    stampPreference(db, key, now);
  }
  return after;
};

/** Fix songs in the whole Library: one run at a time, followed by Settings and stopped by Cancel. */
export interface LibraryFixRun {
  /** How far the run is; null while none goes on. */
  readonly progress: () => LibraryFixProgress | null;
  /** Starts a run, or joins the one going on; answers how it went once it ends. */
  readonly start: () => Promise<FixSongsResult>;
  /** Stops the run after the song under way; what was written stays. */
  readonly cancel: () => void;
}

export const createLibraryFixRun = (ports: {
  /** The Library's songs; Fix Songs picks those that lack something (Core's `songsToFix`). */
  readonly songs: () => readonly number[];
  readonly fix: (ids: readonly number[], options: FixSongsRunOptions) => Promise<FixSongsResult>;
}): LibraryFixRun => {
  let running: { promise: Promise<FixSongsResult>; controller: AbortController } | null = null;
  let progress: LibraryFixProgress = { done: 0, total: 0 };
  return {
    progress: () => (running === null ? null : progress),
    start: () => {
      if (running !== null) return running.promise;
      const controller = new AbortController();
      progress = { done: 0, total: 0 };
      const promise = (async () => {
        try {
          return await ports.fix(ports.songs(), {
            signal: controller.signal,
            progress: (done, total) => {
              progress = { done, total };
            },
          });
        } finally {
          running = null;
        }
      })();
      running = { promise, controller };
      return promise;
    },
    cancel: () => running?.controller.abort(),
  };
};
