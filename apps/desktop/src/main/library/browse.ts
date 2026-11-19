import { sql, type SQL } from "drizzle-orm";
import type { LibraryDatabase } from "@wave/client/db/database";
import { readPlaylistYtSong, type YtAlbumSong } from "@wave/core";
import type { BrowsePage, BrowseRow, BrowseScope } from "../../shared/browse.ts";
import { ytRow } from "../../shared/yt.ts";
import { searchSongIds } from "./search.ts";

const SONGS = sql`SELECT t.id, t.title, t.artist_credit AS artist, a.title AS album,
  t.artwork_hash AS artworkHash, t.duration_ms AS durationMs, 1 AS count,
  t.year, g.name AS genre, t.track_number AS trackNumber, t.path,
  EXISTS(SELECT 1 FROM favorites f WHERE f.track_id=t.id AND f.deleted=0) AS favorite,
  t.title_sort AS sort, p.sort AS artistSort, t.disc_number AS disc, t.album_id AS albumId
  FROM tracks t JOIN artists p ON p.id=t.artist_id JOIN albums a ON a.id=t.album_id LEFT JOIN genres g ON g.id=t.genre_id`;

const listing = (scope: BrowseScope): { source: SQL; order: SQL } => {
  const order = sql`sort, id`;
  switch (scope.kind) {
    case "albums":
      return {
        source: sql`SELECT a.id, a.title, a.album_artist_credit AS artist,
      '' AS album, a.title_sort AS sort, a.artwork_hash AS artworkHash, coalesce(sum(t.duration_ms),0) AS durationMs,
      count(t.id) AS count, a.year,
      (SELECT g.name FROM tracks gt JOIN genres g ON g.id=gt.genre_id WHERE gt.album_id=a.id GROUP BY g.id ORDER BY count(*) DESC, g.sort LIMIT 1) AS genre
      FROM albums a JOIN tracks t ON t.album_id=a.id
      LEFT JOIN genres g ON g.id=t.genre_id GROUP BY a.id`,
        order: sql`sort, wave_sort_key(artist), id`,
      };
    case "artists":
      return {
        source: sql`SELECT a.id, a.name AS title, '' AS artist, '' AS album,
      a.artwork_hash AS artworkHash, coalesce(sum(t.duration_ms),0) AS durationMs,
      count(t.id) AS count, a.sort FROM artists a JOIN track_artists ta ON ta.artist_id=a.id
      JOIN tracks t ON t.id=ta.track_id GROUP BY a.id`,
        order,
      };
    case "genres":
      return {
        source: sql`SELECT g.id, g.name AS title, '' AS artist, '' AS album,
      min(t.artwork_hash) AS artworkHash, sum(t.duration_ms) AS durationMs, count(t.id) AS count, g.sort
      FROM genres g JOIN tracks t ON t.genre_id=g.id GROUP BY g.id`,
        order,
      };
    case "playlists":
      return {
        source: sql`SELECT p.id, p.name AS title, wave_sort_key(p.name) AS sort, '' AS artist, '' AS album,
      p.image_thumb_path AS imageKey,
      (SELECT t.artwork_hash FROM playlist_items i JOIN tracks t ON t.id=i.track_id
        WHERE i.playlist_id=p.id AND i.deleted=0 AND t.artwork_hash IS NOT NULL ORDER BY i.order_key LIMIT 1) AS artworkHash,
      coalesce(sum(t.duration_ms),0) AS durationMs, count(i.id) AS count FROM playlists p
      LEFT JOIN playlist_items i ON i.playlist_id=p.id AND i.deleted=0
      LEFT JOIN tracks t ON t.id=i.track_id WHERE p.deleted=0 GROUP BY p.id`,
        order,
      };
    case "album":
      return {
        source: sql`${SONGS} WHERE t.album_id=${scope.id}`,
        order: sql`coalesce(disc,1), coalesce(trackNumber,9007199254740991), sort, coalesce(path,''), id`,
      };
    case "artist":
      return {
        source: sql`${SONGS} WHERE EXISTS(SELECT 1 FROM track_artists ta WHERE ta.track_id=t.id AND ta.artist_id=${scope.id})`,
        order: sql`sort, artistSort, coalesce(path,''), id`,
      };
    case "genre":
      return {
        source: sql`${SONGS} WHERE t.genre_id=${scope.id}`,
        order: sql`sort, artistSort, coalesce(path,''), id`,
      };
    case "playlist":
      return {
        source: sql`SELECT songs.*, i.order_key AS position FROM (${SONGS}) songs
      JOIN playlist_items i ON i.track_id=songs.id WHERE i.playlist_id=${scope.id} AND i.deleted=0`,
        order: sql`position, id`,
      };
    case "favorites":
      return {
        source: sql`SELECT songs.* FROM (${SONGS}) songs JOIN favorites f ON f.track_id=songs.id WHERE f.deleted=0`,
        order: sql`(SELECT added_at FROM favorites WHERE track_id=id) DESC, sort, id`,
      };
    default:
      return { source: SONGS, order: sql`sort, artistSort, coalesce(path,''), id` };
  }
};

const row = (value: Partial<BrowseRow> & Pick<BrowseRow, "id" | "title">): BrowseRow => ({
  artist: "",
  album: "",
  artworkHash: null,
  durationMs: 0,
  count: 0,
  year: null,
  genre: null,
  trackNumber: null,
  path: null,
  unavailable: false,
  ...value,
  favorite: Boolean(value.favorite),
});

type PlaylistSong =
  { readonly trackId: number } | { readonly itemId: number; readonly song: YtAlbumSong };

const hasStoredEntries = (db: LibraryDatabase, id: number) =>
  db.get(sql`SELECT 1 FROM playlist_items WHERE playlist_id=${id}
    AND deleted=0 AND yt_song IS NOT NULL LIMIT 1`) !== undefined;

// Match Core's readPlaylistYtSong shape so malformed, unsearched and unavailable entries
// do not occupy positions. Decode full song metadata only for rows returned by SQLite.
const storedStream = sql`CASE WHEN json_valid(i.yt_song) THEN
  json_type(i.yt_song, '$.videoId') = 'text' AND json_extract(i.yt_song, '$.videoId') <> ''
  AND json_type(i.yt_song, '$.title') = 'text'
  AND json_type(i.yt_song, '$.artists') = 'array'
  AND NOT EXISTS (SELECT 1 FROM json_each(i.yt_song, '$.artists') WHERE type <> 'text')
  AND json_type(i.yt_song, '$.album') IN ('null', 'text')
  AND json_type(i.yt_song, '$.artworkUrl') IN ('null', 'text')
  AND json_type(i.yt_song, '$.durationMs') IN ('null', 'integer', 'real')
  END`;

const listableEntries = (id: number) => sql`
  FROM playlist_items i
  LEFT JOIN tracks t ON t.id=i.track_id
  LEFT JOIN artists p ON p.id=t.artist_id
  LEFT JOIN albums a ON a.id=t.album_id
  WHERE i.playlist_id=${id} AND i.deleted=0 AND
    (CASE WHEN i.yt_song IS NULL THEN a.id IS NOT NULL AND p.id IS NOT NULL
      ELSE ${storedStream} END)`;

const orderedEntries = (db: LibraryDatabase, source: SQL, page = sql``): PlaylistSong[] =>
  db
    .all<{ itemId: number; trackId: number | null; stored: string | null }>(
      sql`SELECT i.id AS itemId, i.track_id AS trackId, i.yt_song AS stored
      ${source} ORDER BY i.order_key, i.sync_id ${page}`,
    )
    .flatMap(({ itemId, trackId, stored }): PlaylistSong[] => {
      if (stored === null) return trackId === null ? [] : [{ trackId }];
      const song = readPlaylistYtSong(stored);
      return song === null ? [] : [{ itemId, song }];
    });

/** Reads the full mixed order only when starting playback. */
export const playlistSongs = (db: LibraryDatabase, id: number): PlaylistSong[] | undefined =>
  hasStoredEntries(db, id) ? orderedEntries(db, listableEntries(id)) : undefined;

const playlistRows = (
  db: LibraryDatabase,
  songs: readonly PlaylistSong[],
  keepStreams?: (songs: readonly YtAlbumSong[]) => void,
): BrowseRow[] => {
  keepStreams?.(songs.flatMap((entry) => ("song" in entry ? [entry.song] : [])));
  const tracks = new Map(
    browseSongs(
      db,
      songs.flatMap((song) => ("trackId" in song ? [song.trackId] : [])),
    ).map((track) => [track.id, track]),
  );
  return songs.flatMap((song) =>
    "trackId" in song
      ? (tracks.get(song.trackId) ?? [])
      : [{ ...ytRow(song.song), id: -song.itemId }],
  );
};

/** SQLite limits the read before rows cross IPC. No whole-library materialisation. */
export const browseLibrary = (
  db: LibraryDatabase,
  scope: BrowseScope,
  offset: number,
  limit: number,
  keepStreams?: (songs: readonly YtAlbumSong[]) => void,
): BrowsePage => {
  if (scope.kind === "search") {
    const ids = searchSongIds(db, scope.query ?? "");
    return { items: browseSongs(db, ids.slice(offset, offset + limit)), offset, total: ids.length };
  }
  const { source, order } = listing(scope);
  const mixed =
    scope.kind === "playlist" && scope.id !== undefined && hasStoredEntries(db, scope.id)
      ? listableEntries(scope.id)
      : undefined;
  const total = db.get<{ count: number }>(
    mixed ? sql`SELECT count(*) AS count ${mixed}` : sql`SELECT count(*) AS count FROM (${source})`,
  )!.count;
  const page = sql`LIMIT ${limit} OFFSET ${offset}`;
  const items = mixed
    ? playlistRows(db, orderedEntries(db, mixed, page), keepStreams)
    : db.all<BrowseRow>(sql`SELECT * FROM (${source}) ORDER BY ${order} ${page}`).map(row);
  const parentKind = {
    album: "albums",
    artist: "artists",
    playlist: "playlists",
    genre: "genres",
  } as const;
  let hero: BrowseRow | undefined;
  if (scope.kind in parentKind) {
    const kind = parentKind[scope.kind as keyof typeof parentKind];
    const parent = listing({ kind }).source;
    const value = db.get<BrowseRow>(sql`SELECT * FROM (${parent}) WHERE id=${scope.id}`);
    if (value) hero = row(value);
    if (scope.kind === "artist") {
      const name = hero?.title;
      // Read the credited artists at the same page boundary, in credit order.
      for (const item of items) {
        const names = db.all<{ name: string }>(
          sql`SELECT a.name FROM track_artists ta JOIN artists a ON a.id=ta.artist_id WHERE ta.track_id=${item.id} AND a.id<>${scope.id} ORDER BY ta.position`,
        );
        (item as { artist: string }).artist = names
          .map((a) => a.name)
          .filter((n) => n !== name)
          .join(", ");
      }
    }
  }
  return { items, offset, total, ...(hero ? { hero } : {}) };
};

export const browseLetter = (db: LibraryDatabase, scope: BrowseScope, letter: string): number => {
  // Search's songs are in rank order, not by letter.
  if (scope.kind === "search") return 0;
  const { source, order } = listing(scope);
  return (
    db.get<{ position: number }>(sql`SELECT position FROM (
    SELECT sort, row_number() OVER (ORDER BY ${order}) - 1 AS position FROM (${source})
    ) WHERE substr(sort,1,1) >= wave_sort_key(${letter}) ORDER BY position LIMIT 1`)?.position ?? 0
  );
};

/**
 * The ids of [scope]'s Library songs, in the order its list shows them; none for a list of lists.
 * A playlist's YT Music songs aren't among them (`playlistSongs` has those).
 */
export const browseTrackIds = (db: LibraryDatabase, scope: BrowseScope): string[] => {
  if (["albums", "artists", "playlists", "genres"].includes(scope.kind)) return [];
  if (scope.kind === "search") return searchSongIds(db, scope.query ?? "").map(String);
  const { source, order } = listing(scope);
  return db
    .all<{ id: number }>(sql`SELECT id FROM (${source}) ORDER BY ${order}`)
    .map((song) => String(song.id));
};

/** [source]'s rows [ids], in the order given; an id it lacks is left out. */
const rowsById = (db: LibraryDatabase, source: SQL, ids: readonly number[]): BrowseRow[] => {
  if (ids.length === 0) return [];
  const found = new Map<number, BrowseRow>();
  // SQLite takes a bounded number of values per statement; a whole Library's Play reads them all.
  for (let at = 0; at < ids.length; at += 1000)
    for (const value of db.all<BrowseRow>(
      sql`SELECT * FROM (${source}) WHERE id IN (${sql.join(
        ids.slice(at, at + 1000).map((id) => sql`${id}`),
        sql`, `,
      )})`,
    ))
      found.set(value.id, row(value));
  return ids.flatMap((id) => found.get(id) ?? []);
};

/** The songs [ids] as rows, in the order given; an id with no song is left out. */
export const browseSongs = (db: LibraryDatabase, ids: readonly number[]): BrowseRow[] =>
  rowsById(db, SONGS, ids);

/** The albums, artists, playlists or genres [ids] as their lists show them, in the order given. */
export const browseRows = (
  db: LibraryDatabase,
  kind: "albums" | "artists" | "playlists" | "genres",
  ids: readonly number[],
): BrowseRow[] => rowsById(db, listing({ kind }).source, ids);
