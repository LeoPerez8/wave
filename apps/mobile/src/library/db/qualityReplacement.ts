/**
 * Quality replacements (docs/spec.md, "YT Music" › Download quality): the
 * Library's files as Core's offer weighs them (`qualityUpgradeSongs`), the
 * songs with no better copy (`schema.noBetterCopies`), a song as its
 * replacement takes it (Core's `ReplacedTrack`), and the swap itself: the new
 * file takes over the Track in place. Kept free of Expo for the store tests.
 */
import type { NoBetterCopy, QualityDirection, QualityFile, ReplacedTrack } from "@wave/core";
import { and, eq, isNotNull, ne } from "drizzle-orm";

import type { IndexedArtwork, IndexedTrack } from "../LibraryStore.ts";
import { readCredits, type CreditSplits } from "./credits.ts";
import type { LibraryDatabase } from "./database.ts";
import { recordFileDeletions } from "./fileDeletions.ts";
import { saveBatch, type SavedBatch } from "./save.ts";
import * as schema from "./schema.ts";
import { deleteTracksById } from "./tracks.ts";

/**
 * Every Library file with its length, bitrate, size and the video a YouTube
 * download came from; missing songs have no file.
 */
export const selectQualityFiles = (db: LibraryDatabase): QualityFile[] => {
  const t = schema.tracks;
  return db
    .select({
      id: t.id,
      path: t.path,
      durationMs: t.durationMs,
      bitrateKbps: t.bitrateKbps,
      sizeBytes: t.sizeBytes,
      videoId: t.videoId,
    })
    .from(t)
    .where(isNotNull(t.path))
    .orderBy(t.id)
    .all()
    .flatMap(({ path, ...file }) => (path === null ? [] : [{ ...file, path }]));
};

/** The Tracks recorded as having no better copy in [direction]. */
export const selectNoBetterCopies = (db: LibraryDatabase, direction: QualityDirection): number[] =>
  db
    .select({ trackId: schema.noBetterCopies.trackId })
    .from(schema.noBetterCopies)
    .where(eq(schema.noBetterCopies.direction, direction))
    .orderBy(schema.noBetterCopies.trackId)
    .all()
    .map((row) => row.trackId);

/**
 * Records [songs] as having no better copy (Core's `noBetterCopies`), each
 * once; a Track removed meanwhile is skipped.
 */
export const rememberNoBetterCopies = (
  db: LibraryDatabase,
  songs: readonly NoBetterCopy[],
): void => {
  if (songs.length === 0) return;
  const t = schema.tracks;
  db.transaction((tx) => {
    for (const { trackId, direction } of songs) {
      if (tx.select({ id: t.id }).from(t).where(eq(t.id, trackId)).get() === undefined) continue;
      tx.insert(schema.noBetterCopies).values({ trackId, direction }).onConflictDoNothing().run();
    }
  });
};

/** Library song [trackId] as its replacement takes it; null when it's gone or has no file. */
export const selectReplacedTrack = (db: LibraryDatabase, trackId: number): ReplacedTrack | null => {
  const { tracks, albums, genres, artwork } = schema;
  const row = db
    .select({
      id: tracks.id,
      path: tracks.path,
      title: tracks.title,
      artist: tracks.artistCredit,
      artists: tracks.artistCredits,
      album: albums.title,
      albumArtist: albums.albumArtistCredit,
      year: tracks.year,
      trackNumber: tracks.trackNumber,
      discNumber: tracks.discNumber,
      genre: genres.name,
      durationMs: tracks.durationMs,
      videoId: tracks.videoId,
      explicit: tracks.explicit,
      artworkPath: artwork.path,
    })
    .from(tracks)
    .innerJoin(albums, eq(tracks.albumId, albums.id))
    .leftJoin(genres, eq(tracks.genreId, genres.id))
    .leftJoin(artwork, eq(tracks.artworkHash, artwork.hash))
    .where(eq(tracks.id, trackId))
    .get();
  if (row === undefined || row.path === null) return null;
  return {
    ...row,
    path: row.path,
    artists: readCredits(row.artist, row.artists),
    genre: row.genre ?? null,
    artworkPath: row.artworkPath ?? null,
  };
};

/** What replacing a Track's file did. */
export type ReplacedFile =
  | {
      readonly kind: "replaced";
      /**
       * The file the Track had. Unless the new one took its very path, its deletion is
       * recorded with the swap (`schema.fileDeletions`).
       */
      readonly oldPath: string;
      readonly starred: SavedBatch["starred"];
    }
  /** The Track was removed meanwhile, or has no file: nothing was saved; the new file's deletion is recorded. */
  | { readonly kind: "gone" };

/**
 * The new file [track] takes over Track [trackId] in place: the same Track
 * id, and with it its favorites, plays and playlist entries, and its
 * recording key whatever the new tags say (as a missing song's download
 * keeps it, `IndexedTrack.fills`). A Track a scan made of the new file
 * before this (it was published a moment ago) goes: the path is the
 * replaced song's. The old file's deletion is recorded in the same
 * transaction (`recordFileDeletions`), so a kill before it's deleted leaves
 * it recorded for the next launch, and a replayed import (its Track already
 * on the new file) still finds it.
 */
export const replaceTrackFile = (
  db: LibraryDatabase,
  splits: CreditSplits,
  trackId: number,
  track: IndexedTrack,
  artworkRows: readonly IndexedArtwork[],
  now: number,
): ReplacedFile => {
  const t = schema.tracks;
  return db.transaction((tx): ReplacedFile => {
    const old = tx.select({ path: t.path }).from(t).where(eq(t.id, trackId)).get();
    if (old === undefined || old.path === null) {
      // Nothing takes the new file: it goes, never to come back as a song of its own.
      recordFileDeletions(tx, [track.path], now);
      return { kind: "gone" };
    }
    const oldPath = old.path;
    if (oldPath !== track.path) {
      const stray = tx
        .select({ id: t.id })
        .from(t)
        .where(and(eq(t.path, track.path), ne(t.id, trackId)))
        .all()
        .map((row) => row.id);
      deleteTracksById(tx, stray);
    }
    const { starred } = saveBatch(
      tx,
      splits,
      [{ ...track, fills: trackId }],
      artworkRows,
      oldPath === track.path ? [] : [{ from: oldPath, to: track.path }],
      now,
    );
    // The old file must go: recorded with the swap, so a kill before it's deleted can't leave it.
    if (oldPath !== track.path) recordFileDeletions(tx, [oldPath], now);
    return { kind: "replaced", oldPath, starred };
  });
};
