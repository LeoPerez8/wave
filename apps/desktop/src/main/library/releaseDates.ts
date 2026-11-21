/**
 * A song's Release Date on main's side (docs/spec.md, "Release date"): the date it shows, and the
 * one the owner types, kept as the phone keeps it: in the synced typed dates
 * (`releaseDates.typed.*`), so it reaches the phone and wins there too, and for a Library song in
 * the index as well.
 */
import type { LibraryDatabase } from "@wave/client/db/database";
import { saveTypedReleaseDate } from "@wave/client/db/releaseDates";
import { stampPreference } from "@wave/client/db/sync";
import {
  TYPED_RELEASE_BUCKETS,
  joinArtists,
  readTypedReleaseDate,
  readTypedReleaseDates,
  releaseShownDate,
  storedSyncedBucket,
  syncedBucket,
  typedReleaseDateOf,
  typedReleaseEntry,
  typedReleaseKey,
  withSyncedBucketEntry,
  type ReleaseKeySong,
  type TypedReleaseDateFields,
  type YtAlbumSong,
} from "@wave/core";
import { sql } from "drizzle-orm";
import type { ReleaseDateSaved, ReleaseDateView } from "../../shared/releaseDates.ts";
import { keepPreference, syncedPreference } from "../sync/desktopSync.ts";
import { streamedLibraryFacts } from "../yt/streamedSong.ts";

/** A song as its release date reads it: its key's title, artist and album, and its own dates. */
export interface ReleaseDateSong extends ReleaseKeySong {
  readonly album: string | null;
  /** The Library song, whose index takes a typed date too; null for a streamed song. */
  readonly trackId: number | null;
  /** The original-date tag, as the index has it. */
  readonly original: string | null;
  readonly year: number | null;
}

const bucketKey = (bucket: number) => `releaseDates.typed.${bucket}`;

/** Every typed date, by song key (Core's `typedReleaseKey`), from the synced preferences. */
export const typedReleaseDates = (db: LibraryDatabase): Readonly<Record<string, string>> =>
  Object.assign(
    {},
    ...Array.from({ length: TYPED_RELEASE_BUCKETS }, (_, bucket) =>
      readTypedReleaseDates(syncedPreference(db, bucketKey(bucket))),
    ),
  );

/** The Library song [trackId] as its release date reads it; undefined when it's gone. */
export const libraryReleaseSong = (
  db: LibraryDatabase,
  trackId: number,
): ReleaseDateSong | undefined => {
  const song = db.get<{
    title: string;
    artist: string;
    album: string | null;
    original: string | null;
    year: number | null;
  }>(
    sql`SELECT t.title, t.artist_credit AS artist, a.title AS album, t.release_date AS original,
      t.year FROM tracks t LEFT JOIN albums a ON a.id = t.album_id WHERE t.id = ${trackId}`,
  );
  return song === undefined ? undefined : { ...song, trackId };
};

/**
 * A streamed song as its release date reads it, by its own title, artists and album, as the
 * phone keys it; the Library's song it is by now takes a typed date in the index too.
 */
export const streamedReleaseSong = (db: LibraryDatabase, song: YtAlbumSong): ReleaseDateSong => {
  const { track } = streamedLibraryFacts(db, song);
  return {
    title: song.title,
    artist: joinArtists(song.artists),
    album: song.album ?? null,
    trackId: track?.id ?? null,
    original: track?.releaseDate ?? null,
    year: track?.year ?? null,
  };
};

/** The date [song] shows and sorts by (Core's `releaseShownDate`), typed first. */
export const releaseSongDate = (
  typed: Readonly<Record<string, string>>,
  song: ReleaseKeySong & { readonly original?: string | null; readonly year?: number | null },
): string | null =>
  releaseShownDate({
    typed: typedReleaseDateOf(typed, song),
    original: song.original,
    year: song.year,
  });

/** What Release Date's dialog shows for [song]. */
export const releaseDateView = (db: LibraryDatabase, song: ReleaseDateSong): ReleaseDateView => {
  const typed = typedReleaseDates(db);
  return {
    title: song.title,
    date: releaseSongDate(typed, song),
    typed: typedReleaseDateOf(typed, song) !== null,
  };
};

/**
 * Keeps the date [fields] give (Core's `readTypedReleaseDate`, no later than [today]) as [song]'s
 * typed release date, or clears the one it has (null): in its synced preference, stamped at
 * [now] so the account sends it, and for a Library song in the index. Refused, nothing changes.
 */
export const saveReleaseDate = (
  db: LibraryDatabase,
  song: ReleaseDateSong,
  fields: TypedReleaseDateFields | null,
  today: string,
  now: number,
): ReleaseDateSaved => {
  let date: string | null = null;
  if (fields !== null) {
    const read = readTypedReleaseDate(fields, today);
    if (!read.ok) return { ok: false, problem: read.problem };
    date = read.date;
  }
  const key =
    date === null ? typedReleaseEntry(typedReleaseDates(db), song)?.key : typedReleaseKey(song);
  if (key !== undefined) {
    const bucket = bucketKey(syncedBucket(key, TYPED_RELEASE_BUCKETS));
    const next = withSyncedBucketEntry(
      readTypedReleaseDates(syncedPreference(db, bucket)),
      key,
      date,
    );
    if (next === null) return { ok: false, problem: "full" };
    keepPreference(db, bucket, storedSyncedBucket(next));
    stampPreference(db, bucket, now);
  }
  if (song.trackId !== null) saveTypedReleaseDate(db, song.trackId, date);
  return { ok: true };
};
