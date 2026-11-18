/**
 * What a Track is as it leaves the Library (Core's `LeavingSong`): the one
 * read every way a song leaves goes through, so a playlist entry kept here
 * (`keepPlaylistEntries`), one sent up for another phone (`selectUnpushed`)
 * and the song Now Playing streams on (Core's `streamedAfterDelete`) agree.
 * Kept free of Expo so the store tests run it against a real SQLite.
 */
import type { LeavingSong } from "@wave/core";
import { eq } from "drizzle-orm";

import { readCredits } from "./credits.ts";
import type { LibraryDatabase } from "./database.ts";
import * as schema from "./schema.ts";

/** The Track's columns (its album joined) that `leavingSong` reads. */
export const leavingSongColumns = {
  videoId: schema.tracks.videoId,
  title: schema.tracks.title,
  artist: schema.tracks.artistCredit,
  artists: schema.tracks.artistCredits,
  album: schema.albums.title,
  durationMs: schema.tracks.durationMs,
  explicit: schema.tracks.explicit,
};

/** A row of `leavingSongColumns`; a left join may leave the album, length or flag out. */
export interface LeavingSongRow {
  readonly videoId: string | null;
  readonly title: string;
  readonly artist: string;
  readonly artists: string | null;
  readonly album: string | null;
  readonly durationMs: number | null;
  readonly explicit: string | null;
}

/** The song [row] is as it leaves the Library: each of its credits an artist (`readCredits`). */
export const leavingSong = (row: LeavingSongRow): LeavingSong => ({
  videoId: row.videoId,
  title: row.title,
  artist: row.artist,
  artists: readCredits(row.artist, row.artists),
  album: row.album ?? "",
  durationMs: row.durationMs ?? 0,
  explicit: row.explicit === "explicit",
});

/** The Library song [id] as it would leave the Library; null when it isn't there. */
export const selectLeavingSong = (db: LibraryDatabase, id: number): LeavingSong | null => {
  const row = db
    .select(leavingSongColumns)
    .from(schema.tracks)
    .innerJoin(schema.albums, eq(schema.tracks.albumId, schema.albums.id))
    .where(eq(schema.tracks.id, id))
    .get();
  return row === undefined ? null : leavingSong(row);
};
