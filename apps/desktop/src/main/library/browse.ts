import { sql, type SQL } from "drizzle-orm";
import type { LibraryDatabase } from "@wave/client/db/database";
import type { BrowsePage, BrowseRow, BrowseScope } from "../../shared/browse.ts";

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
    case "search":
      return {
        source: sql`${SONGS} WHERE instr(lower(t.title || ' ' || t.artist_credit || ' ' || a.title), lower(${scope.query ?? ""}))>0`,
        order,
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

/** SQLite limits the read before rows cross IPC. No whole-library materialisation. */
export const browseLibrary = (
  db: LibraryDatabase,
  scope: BrowseScope,
  offset: number,
  limit: number,
): BrowsePage => {
  const { source, order } = listing(scope);
  const total = db.get<{ count: number }>(sql`SELECT count(*) AS count FROM (${source})`)!.count;
  const items = db
    .all<BrowseRow>(
      sql`SELECT * FROM (${source}) ORDER BY ${order} LIMIT ${limit} OFFSET ${offset}`,
    )
    .map(row);
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
  const { source, order } = listing(scope);
  return (
    db.get<{ position: number }>(sql`SELECT position FROM (
    SELECT sort, row_number() OVER (ORDER BY ${order}) - 1 AS position FROM (${source})
    ) WHERE substr(sort,1,1) >= wave_sort_key(${letter}) ORDER BY position LIMIT 1`)?.position ?? 0
  );
};
