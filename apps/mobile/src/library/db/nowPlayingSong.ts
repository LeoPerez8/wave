/** One targeted statement supplies identity, file and both kinds of star. */
import { recordingMatches, parseTrackId } from "@wave/core";
import { eq, sql } from "drizzle-orm";
import type { PlayingSongAnswer, PlayingSongTarget } from "../../nowPlaying/songLookup.ts";
import type { LibraryDatabase } from "./database.ts";
import type { SongRow } from "../LibraryStore.ts";
import { matchingSongWhere } from "./matchingSong.ts";
import { albums, artists, artwork, favorites, pendingFavorites, tracks } from "./schema.ts";
import { BY_TITLE, songColumns } from "./tracks.ts";

export const selectNowPlayingSong = (
  db: LibraryDatabase,
  target: PlayingSongTarget,
): PlayingSongAnswer => {
  const ref = parseTrackId(target.trackId);
  const where =
    ref?.kind === "library"
      ? eq(tracks.id, ref.id)
      : target.song === null
        ? sql`0`
        : matchingSongWhere(target.song);
  const rows = db
    .select({
      ...songColumns,
      favorite:
        sql<boolean>`EXISTS(SELECT 1 FROM ${favorites} WHERE ${favorites.trackId} = ${tracks.id} AND ${favorites.deleted} = 0)`.mapWith(
          Boolean,
        ),
      pendingFavorite:
        sql<boolean>`EXISTS(SELECT 1 FROM ${pendingFavorites} WHERE ${pendingFavorites.videoId} = ${ref?.kind === "yt" ? ref.videoId : ""})`.mapWith(
          Boolean,
        ),
    })
    // Keep a row even without a matching song: a streamed song can have a pending star.
    .from(sql`(SELECT 1) AS requested_song`)
    .leftJoin(tracks, where)
    .leftJoin(artists, eq(tracks.artistId, artists.id))
    .leftJoin(albums, eq(tracks.albumId, albums.id))
    .leftJoin(artwork, eq(tracks.artworkHash, artwork.hash))
    .orderBy(...BY_TITLE)
    .all();
  const candidates = rows.filter(
    (row): row is SongRow & { artistIds: number[]; favorite: boolean; pendingFavorite: boolean } =>
      row.id !== null,
  );
  const match =
    ref?.kind === "library"
      ? candidates[0]
      : target.song === null
        ? undefined
        : candidates.find((candidate) => recordingMatches(candidate, target.song!));
  if (match === undefined)
    return { track: null, favorite: false, pendingFavorite: rows[0]?.pendingFavorite ?? false };
  const { favorite, pendingFavorite, ...track } = match;
  return { track, favorite, pendingFavorite };
};
