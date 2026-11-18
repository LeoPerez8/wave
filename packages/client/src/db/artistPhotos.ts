/**
 * Artist photos downloaded from an online service: which artists to look up
 * (Core's `artistPhotoLookups`), each lookup's outcome, and the saved files.
 * Kept free of Expo so the store tests run it against a real SQLite.
 */
import { artistPhotoLookups, type ArtistPhotoCheck } from "@wave/core";

import type { LibraryDatabase } from "./database.ts";
import * as schema from "./schema.ts";

/** An artist whose photo to look up, with the name to search. */
export interface ArtistPhotoLookup {
  readonly key: string;
  readonly name: string;
  readonly query: string;
}

/** A downloaded photo, by artist key. */
export interface ArtistPhotoRow {
  readonly key: string;
  readonly path: string;
  readonly thumbPath: string;
}

/** A lookup's outcome to record; a found photo comes with its files. */
export type ArtistPhotoRecord =
  | (ArtistPhotoCheck & {
      readonly outcome: "found";
      readonly path: string;
      readonly thumbPath: string;
    })
  | (ArtistPhotoCheck & { readonly outcome: "unmatched" | "failed" });

/** The library's artists whose photo is due at [now], in the Library's order. */
export const selectArtistPhotoLookups = (db: LibraryDatabase, now: number): ArtistPhotoLookup[] => {
  const { artists, artistPhotos } = schema;
  const checks = new Map<string, ArtistPhotoCheck>(
    db
      .select({
        key: artistPhotos.artistKey,
        outcome: artistPhotos.outcome,
        checkedAt: artistPhotos.checkedAt,
      })
      .from(artistPhotos)
      .all()
      .map(({ key, ...check }) => [key, check]),
  );
  const library = db
    .select({ key: artists.key, name: artists.name })
    .from(artists)
    .orderBy(artists.sort, artists.id)
    .all();
  return artistPhotoLookups(library, checks, now);
};

/** Records how [artistKey]'s lookup went, replacing any earlier one. */
export const recordArtistPhoto = (
  db: LibraryDatabase,
  artistKey: string,
  record: ArtistPhotoRecord,
): void => {
  const row = {
    outcome: record.outcome,
    checkedAt: record.checkedAt,
    path: record.outcome === "found" ? record.path : null,
    thumbPath: record.outcome === "found" ? record.thumbPath : null,
  };
  db.insert(schema.artistPhotos)
    .values({ artistKey, ...row })
    .onConflictDoUpdate({ target: schema.artistPhotos.artistKey, set: row })
    .run();
};

/** Every downloaded photo. */
export const selectArtistPhotos = (db: LibraryDatabase): ArtistPhotoRow[] => {
  const { artistPhotos } = schema;
  return db
    .select({
      key: artistPhotos.artistKey,
      path: artistPhotos.path,
      thumbPath: artistPhotos.thumbPath,
    })
    .from(artistPhotos)
    .all()
    .flatMap(({ key, path, thumbPath }) =>
      path === null || thumbPath === null ? [] : [{ key, path, thumbPath }],
    );
};

/** Forgets every photo and every miss (the files are deleted separately). */
export const clearArtistPhotos = (db: LibraryDatabase): void => {
  db.delete(schema.artistPhotos).run();
};
