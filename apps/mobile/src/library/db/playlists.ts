/**
 * The playlist rows the playlist screen and Auto's playlists read, and the
 * edits to what a playlist holds. A playlist holds Library tracks and YT
 * Music songs the Library doesn't have (Core's `PlaylistSong`), side by side.
 * Kept free of Expo so the store tests run them against a real SQLite
 * (`testDatabase.ts`).
 */
import {
  planPlaylistSongs,
  playlistEntryLinks,
  playlistMosaic,
  readPlaylistYtSong,
  writePlaylistYtSong,
  type MixedSong,
  type PlaylistSong,
  type YtAlbumSong,
} from "@wave/core";
import { and, asc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";

import type { LibraryDatabase, RowPage } from "./database.ts";
import * as schema from "./schema.ts";
import { songColumns } from "./tracks.ts";

/** A playlist's Library tracks with their playlist item, in playlist order. */
const playlistTracks = (db: LibraryDatabase, playlistId: number, itemIds?: readonly number[]) => {
  const { playlistItems, tracks, artists, albums, artwork } = schema;
  return db
    .select({ ...songColumns, itemId: playlistItems.id })
    .from(playlistItems)
    .innerJoin(tracks, eq(playlistItems.trackId, tracks.id))
    .innerJoin(artists, eq(tracks.artistId, artists.id))
    .innerJoin(albums, eq(tracks.albumId, albums.id))
    .leftJoin(artwork, eq(tracks.artworkHash, artwork.hash))
    .where(
      and(
        eq(playlistItems.playlistId, playlistId),
        itemIds === undefined ? undefined : inArray(playlistItems.id, [...itemIds]),
      ),
    )
    .all();
};

/** A Library track as a playlist lists it. */
export type PlaylistTrack = Omit<ReturnType<typeof playlistTracks>[number], "itemId">;

/**
 * One entry of a playlist, in its place (`itemId`; the same song may be in it
 * more than once): a Library track, or a YT Music song streamed.
 */
export type PlaylistEntry<T = PlaylistTrack> = MixedSong<YtAlbumSong, T> & {
  readonly itemId: number;
};

/**
 * A playlist's entries in playlist order, [page] of them if given. A YT Music
 * entry whose stored song can't be read is left out.
 */
export const selectPlaylistEntries = (
  db: LibraryDatabase,
  playlistId: number,
  page?: RowPage,
): PlaylistEntry[] => {
  const { playlistItems } = schema;
  const query = db
    .select({ id: playlistItems.id, ytSong: playlistItems.ytSong })
    .from(playlistItems)
    .where(eq(playlistItems.playlistId, playlistId))
    .orderBy(asc(playlistItems.position), asc(playlistItems.id));
  const items =
    page === undefined ? query.all() : query.limit(page.limit).offset(page.offset).all();
  if (items.length === 0) return [];
  // A page reads only its own tracks; the whole list, the playlist's.
  const tracks = new Map(
    playlistTracks(
      db,
      playlistId,
      page === undefined ? undefined : items.map((item) => item.id),
    ).map(({ itemId, ...track }) => [itemId, track]),
  );
  return items.flatMap((item): PlaylistEntry[] => {
    if (item.ytSong !== null) {
      const song = readPlaylistYtSong(item.ytSong);
      return song === null ? [] : [{ itemId: item.id, source: "stream", song }];
    }
    const track = tracks.get(item.id);
    return track === undefined ? [] : [{ itemId: item.id, source: "library", track }];
  });
};

/** Every track's id and file path, for matching an imported playlist's entries (Core's `libraryPathIndex`). */
export const selectTrackPaths = (db: LibraryDatabase) =>
  db.select({ id: schema.tracks.id, path: schema.tracks.path }).from(schema.tracks).all();

/** Rows per insert, well under SQLite's limit on bound values. */
const INSERT_CHUNK = 200;

/** Inserts playlist entries [rows] (any number), in inserts of a size SQLite takes. */
const insertPlaylistItems = (
  db: LibraryDatabase,
  rows: readonly (typeof schema.playlistItems.$inferInsert)[],
): void => {
  for (let i = 0; i < rows.length; i += INSERT_CHUNK) {
    db.insert(schema.playlistItems)
      .values(rows.slice(i, i + INSERT_CHUNK))
      .run();
  }
};

/** [songs] as playlist rows from [position] on. */
const itemRows = (
  playlistId: number,
  songs: readonly PlaylistSong[],
  position: number,
  now: number,
): (typeof schema.playlistItems.$inferInsert)[] =>
  songs.map((song, i) => ({
    playlistId,
    trackId: song.source === "library" ? song.trackId : null,
    ytSong: song.source === "stream" ? writePlaylistYtSong(song.song) : null,
    position: position + i,
    addedAt: now,
  }));

/** What a playlist holds, as Core's `planPlaylistSongs` compares it. */
const heldSongs = (db: LibraryDatabase, playlistId: number): PlaylistSong[] => {
  const { playlistItems } = schema;
  return db
    .select({ trackId: playlistItems.trackId, ytSong: playlistItems.ytSong })
    .from(playlistItems)
    .where(eq(playlistItems.playlistId, playlistId))
    .all()
    .flatMap((row): PlaylistSong[] => {
      if (row.trackId !== null) return [{ source: "library", trackId: row.trackId }];
      const song = row.ytSong === null ? null : readPlaylistYtSong(row.ytSong);
      return song === null ? [] : [{ source: "stream", song }];
    });
};

/**
 * Appends [songs] to a playlist, Library tracks and YT Music songs alike,
 * except those it already holds (Core's `planPlaylistSongs`); returns how many
 * went in and how many were skipped. Run it inside the caller's transaction.
 */
export const appendPlaylistSongs = (
  db: LibraryDatabase,
  playlistId: number,
  songs: readonly PlaylistSong[],
  now: number,
): { readonly added: number; readonly alreadyIn: number } => {
  const { playlistItems } = schema;
  const plan = planPlaylistSongs(heldSongs(db, playlistId), songs);
  const last =
    db
      .select({ position: sql<number | null>`max(${playlistItems.position})` })
      .from(playlistItems)
      .where(eq(playlistItems.playlistId, playlistId))
      .get()?.position ?? -1;
  insertPlaylistItems(db, itemRows(playlistId, plan.add, last + 1, now));
  return { added: plan.add.length, alreadyIn: plan.alreadyIn };
};

/**
 * Makes a playlist hold exactly [songs], in that order (an import's
 * Replace): the same playlist, so its name and place stay.
 */
export const replacePlaylistSongs = (
  db: LibraryDatabase,
  playlistId: number,
  songs: readonly PlaylistSong[],
  now: number,
): void => {
  db.transaction((tx) => {
    const { playlists, playlistItems } = schema;
    tx.delete(playlistItems).where(eq(playlistItems.playlistId, playlistId)).run();
    insertPlaylistItems(tx, itemRows(playlistId, songs, 0, now));
    tx.update(playlists).set({ updatedAt: now }).where(eq(playlists.id, playlistId)).run();
  });
};

/**
 * Removes the given entries from a playlist in one go (each entry on its own,
 * so another copy of the same song stays); ids from other playlists are ignored.
 */
export const removePlaylistItems = (
  db: LibraryDatabase,
  playlistId: number,
  itemIds: readonly number[],
  now: number,
): void => {
  if (itemIds.length === 0) return;
  db.transaction((tx) => {
    const { playlists, playlistItems } = schema;
    tx.delete(playlistItems)
      .where(and(eq(playlistItems.playlistId, playlistId), inArray(playlistItems.id, [...itemIds])))
      .run();
    tx.update(playlists).set({ updatedAt: now }).where(eq(playlists.id, playlistId)).run();
  });
};

/** Track ids per query, well under SQLite's limit on bound values. */
const LINK_CHUNK = 500;

/**
 * Turns the YT Music entries of every playlist that the Library tracks
 * [trackIds] (just downloaded; the whole Library when not given, as a scan
 * does once it ends) positively are (Core's `playlistEntryLinks`) into those
 * tracks, in the same place; an entry whose track its playlist already holds
 * is removed instead. Returns how many entries it changed. Does nothing (one
 * small query) while no playlist holds a YT Music entry. Run it inside the
 * caller's transaction.
 */
export const linkPlaylistEntries = (db: LibraryDatabase, trackIds?: readonly number[]): number => {
  const { playlistItems, tracks } = schema;
  if (trackIds?.length === 0) return 0;
  const anyEntry = db
    .select({ id: playlistItems.id })
    .from(playlistItems)
    .where(isNotNull(playlistItems.ytSong))
    .limit(1)
    .get();
  if (anyEntry === undefined) return 0;
  const entries = db
    .select({
      itemId: playlistItems.id,
      playlistId: playlistItems.playlistId,
      ytSong: playlistItems.ytSong,
    })
    .from(playlistItems)
    .where(isNotNull(playlistItems.ytSong))
    .orderBy(asc(playlistItems.playlistId), asc(playlistItems.position), asc(playlistItems.id))
    .all()
    .flatMap(({ itemId, playlistId, ytSong }) => {
      const song = ytSong === null ? null : readPlaylistYtSong(ytSong);
      return song === null ? [] : [{ itemId, playlistId, song }];
    });
  if (entries.length === 0) return 0;
  const columns = {
    id: tracks.id,
    title: tracks.title,
    artist: tracks.artistCredit,
    durationMs: tracks.durationMs,
  };
  const library: { id: number; title: string; artist: string; durationMs: number }[] =
    trackIds === undefined ? db.select(columns).from(tracks).all() : [];
  for (let i = 0; trackIds !== undefined && i < trackIds.length; i += LINK_CHUNK) {
    library.push(
      ...db
        .select(columns)
        .from(tracks)
        .where(inArray(tracks.id, trackIds.slice(i, i + LINK_CHUNK)))
        .all(),
    );
  }
  const held = db
    .select({ playlistId: playlistItems.playlistId, trackId: playlistItems.trackId })
    .from(playlistItems)
    .where(
      and(
        isNotNull(playlistItems.trackId),
        inArray(playlistItems.playlistId, [...new Set(entries.map((entry) => entry.playlistId))]),
      ),
    )
    .all()
    .flatMap(({ playlistId, trackId }) => (trackId === null ? [] : [{ playlistId, trackId }]));
  const { links, drops } = playlistEntryLinks(entries, library, held);
  for (const { itemId, trackId } of links) {
    db.update(playlistItems)
      .set({ trackId, ytSong: null })
      .where(and(eq(playlistItems.id, itemId), isNull(playlistItems.trackId)))
      .run();
  }
  for (let i = 0; i < drops.length; i += LINK_CHUNK) {
    db.delete(playlistItems)
      .where(inArray(playlistItems.id, drops.slice(i, i + LINK_CHUNK)))
      .run();
  }
  return links.length + drops.length;
};

/** A playlist's mosaic: thumbnails for lists and menus, full-size covers for its screen's header. */
export interface PlaylistCovers {
  readonly thumbPaths: readonly string[];
  readonly artworkPaths: readonly string[];
}

/** The most tiles a mosaic has (Core's `playlistMosaic`). */
const MOSAIC_TILES = 4;

/**
 * Each playlist's mosaic (Core's `playlistMosaic`), from what it holds in
 * playlist order: a Library track's album cover (a file), a YT Music entry's
 * cover (YouTube's address). Only [playlistId]'s when given. SQLite picks each
 * playlist's first four different covers, so only those are read.
 */
export const selectPlaylistCovers = (
  db: LibraryDatabase,
  playlistId?: number,
): Map<number, PlaylistCovers> => {
  const inPlaylist = playlistId === undefined ? sql`1` : sql`pi.playlist_id = ${playlistId}`;
  // A cover is an artwork row (its file and thumbnail) or an entry's address
  // (both at once); unreadable stored songs give none.
  const rows = db.all<{ playlistId: number; thumbPath: string; path: string }>(sql`
    WITH items AS (
      SELECT pi.playlist_id, pi.position, pi.id, al.artwork_hash,
        CASE WHEN json_valid(pi.yt_song) THEN
          CASE json_type(pi.yt_song, '$.artworkUrl')
            WHEN 'text' THEN json_extract(pi.yt_song, '$.artworkUrl')
          END
        END AS url
      FROM playlist_items pi
      LEFT JOIN tracks t ON t.id = pi.track_id
      LEFT JOIN albums al ON al.id = t.album_id
      WHERE ${inPlaylist}
    ),
    covers AS (
      SELECT items.playlist_id, items.position, items.id,
        coalesce(aw.hash, items.url) AS cover,
        coalesce(aw.thumb_path, items.url) AS thumb_path,
        coalesce(aw.path, items.url) AS path
      FROM items
      LEFT JOIN artwork aw ON aw.hash = items.artwork_hash
    ),
    firsts AS (
      SELECT *, row_number() OVER (
        PARTITION BY playlist_id, cover ORDER BY position, id
      ) AS seen
      FROM covers
      WHERE cover IS NOT NULL
    ),
    tiles AS (
      SELECT *, row_number() OVER (
        PARTITION BY playlist_id ORDER BY position, id
      ) AS tile
      FROM firsts
      WHERE seen = 1
    )
    SELECT playlist_id AS playlistId, thumb_path AS thumbPath, path
    FROM tiles
    WHERE tile <= ${MOSAIC_TILES}
    ORDER BY playlist_id, tile`);
  const grouped = new Map<number, { thumbs: string[]; paths: string[] }>();
  for (const row of rows) {
    let group = grouped.get(row.playlistId);
    if (group === undefined) {
      group = { thumbs: [], paths: [] };
      grouped.set(row.playlistId, group);
    }
    group.thumbs.push(row.thumbPath);
    group.paths.push(row.path);
  }
  return new Map(
    [...grouped].map(([id, group]) => [
      id,
      { thumbPaths: playlistMosaic(group.thumbs), artworkPaths: playlistMosaic(group.paths) },
    ]),
  );
};

/** How many songs a playlist holds and how long they play. */
export interface PlaylistTotals {
  readonly trackCount: number;
  readonly durationMs: number;
}

/**
 * Each playlist's song count and length (only [playlistId]'s when given), YT
 * Music entries included (one of unknown length adds nothing to it). An entry
 * whose stored song can't be read is left out, as the playlist's list leaves
 * it out (`selectPlaylistEntries`: both read it with Core's
 * `readPlaylistYtSong`). Playlists holding nothing are left out.
 */
export const selectPlaylistTotals = (
  db: LibraryDatabase,
  playlistId?: number,
): Map<number, PlaylistTotals> => {
  const { playlistItems, tracks } = schema;
  const inPlaylist =
    playlistId === undefined ? undefined : eq(playlistItems.playlistId, playlistId);
  const totals = new Map<number, { trackCount: number; durationMs: number }>(
    db
      .select({
        playlistId: playlistItems.playlistId,
        trackCount: sql<number>`count(*)`,
        durationMs: sql<number>`coalesce(sum(${tracks.durationMs}), 0)`,
      })
      .from(playlistItems)
      // A Library entry whose track is gone is on its way out (the cascade), never counted.
      .innerJoin(tracks, eq(playlistItems.trackId, tracks.id))
      .where(inPlaylist)
      .groupBy(playlistItems.playlistId)
      .all()
      .map(({ playlistId: id, ...total }) => [id, total]),
  );
  const streamed = db
    .select({ playlistId: playlistItems.playlistId, ytSong: playlistItems.ytSong })
    .from(playlistItems)
    .where(and(isNotNull(playlistItems.ytSong), inPlaylist))
    .all();
  for (const row of streamed) {
    const song = row.ytSong === null ? null : readPlaylistYtSong(row.ytSong);
    if (song === null) continue;
    const total = totals.get(row.playlistId) ?? { trackCount: 0, durationMs: 0 };
    total.trackCount += 1;
    total.durationMs += song.durationMs ?? 0;
    totals.set(row.playlistId, total);
  }
  return totals;
};
