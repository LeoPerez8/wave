import { asc, desc, sql, type SQL } from "drizzle-orm";
import type { LibraryDatabase } from "@wave/client/db/database";
import { selectYtArtist } from "@wave/client/db/ytArtists";
import {
  artistPopularSongs,
  artistSongOrder,
  defaultSongSort,
  identityKey,
  joinArtists,
  readPlaylistYtSong,
  sortPlaylistSongs,
  stepYtArtistSection,
  YT_ARTIST_SECTION_START,
  type PlaylistSongSort,
  type SongSort,
  type YtAlbumSong,
  type YtSong,
} from "@wave/core";
import type { BrowsePage, BrowseRow, BrowseScope } from "../../shared/browse.ts";
import { ytRow } from "../../shared/yt.ts";
import { searchSongIds } from "./search.ts";
import {
  playlistSongSort,
  readBrowseSort,
  songBrowseOrder,
  songBrowseSpine,
} from "./browseSort.ts";

const SONGS = sql`SELECT t.id, t.title, t.artist_credit AS artist, a.title AS album,
  t.artwork_hash AS artworkHash, t.duration_ms AS durationMs, 1 AS count,
  t.year, g.name AS genre, t.track_number AS trackNumber, t.path,
  EXISTS(SELECT 1 FROM favorites f WHERE f.track_id=t.id AND f.deleted=0) AS favorite,
  t.title_sort AS sort, p.sort AS artistSort, a.title_sort AS albumSort, t.added_at AS addedAt,
  t.disc_number AS disc, t.album_id AS albumId, t.release_date AS releaseDate
  FROM tracks t JOIN artists p ON p.id=t.artist_id JOIN albums a ON a.id=t.album_id LEFT JOIN genres g ON g.id=t.genre_id`;

const listing = (scope: BrowseScope, sort?: SongSort): { source: SQL; order: SQL } => {
  const name = sort?.descending ? desc(sql`sort`) : asc(sql`sort`);
  const order = sql`${name}, id`;
  switch (scope.kind) {
    case "albums":
      return {
        source: sql`SELECT a.id, a.title, a.album_artist_credit AS artist,
      '' AS album, a.title_sort AS sort, ar.sort AS artistSort, a.artwork_hash AS artworkHash, coalesce(sum(t.duration_ms),0) AS durationMs,
      count(t.id) AS count, a.year,
      (SELECT g.name FROM tracks gt JOIN genres g ON g.id=gt.genre_id WHERE gt.album_id=a.id GROUP BY g.id ORDER BY count(*) DESC, g.sort LIMIT 1) AS genre
      FROM albums a JOIN tracks t ON t.album_id=a.id JOIN artists ar ON ar.id=a.album_artist_id
      GROUP BY a.id`,
        order: sql`${name}, artistSort, id`,
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
        order: songBrowseOrder(sort ?? defaultSongSort("artist")),
      };
    case "genre":
      return {
        source: sql`${SONGS} WHERE t.genre_id=${scope.id}`,
        order: songBrowseOrder(sort ?? defaultSongSort("genre")),
      };
    case "playlist":
      return {
        source: sql`SELECT songs.*, i.order_key AS position, i.added_at AS entryAddedAt FROM (${SONGS}) songs
      JOIN playlist_items i ON i.track_id=songs.id WHERE i.playlist_id=${scope.id} AND i.deleted=0`,
        order: sql`position, id`,
      };
    case "favorites":
      return {
        source: sql`SELECT songs.*, f.added_at AS starredAt FROM (${SONGS}) songs
          JOIN favorites f ON f.track_id=songs.id WHERE f.deleted=0`,
        order: songBrowseOrder(sort ?? defaultSongSort("favorites")),
      };
    case "songs":
      return {
        source: SONGS,
        order: songBrowseOrder(sort ?? defaultSongSort("songs")),
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

type PlaylistSong = (
  { readonly trackId: number } | { readonly itemId: number; readonly song: YtAlbumSong }
) & {
  /** When the entry joined the playlist, and its place (from 1) in the playlist's own order. */
  readonly addedAt?: number;
  readonly order?: number;
};

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
    .all<{ itemId: number; trackId: number | null; stored: string | null; addedAt: number }>(
      sql`SELECT i.id AS itemId, i.track_id AS trackId, i.yt_song AS stored, i.added_at AS addedAt
      ${source} ORDER BY i.order_key, i.sync_id ${page}`,
    )
    .flatMap(({ itemId, trackId, stored, addedAt }): PlaylistSong[] => {
      if (stored === null) return trackId === null ? [] : [{ trackId, addedAt }];
      const song = readPlaylistYtSong(stored);
      return song === null ? [] : [{ itemId, song, addedAt }];
    });

/** The date a playlist's Release date sort reads for a Library song: its date tag, else its Year. */
const released = (song: { readonly releaseDate?: string | null; readonly year: number | null }) =>
  song.releaseDate || (song.year ? String(song.year) : undefined);

/**
 * The playlist's every entry in [sort]'s order (Core's `sortPlaylistSongs`), each with its place
 * in the playlist's own order. A sort reads the whole playlist: SQLite can't page Core's order.
 */
const sortedEntries = (db: LibraryDatabase, id: number, sort: PlaylistSongSort): PlaylistSong[] => {
  const entries = db
    .all<{
      itemId: number;
      trackId: number | null;
      stored: string | null;
      addedAt: number;
      title: string | null;
      artist: string | null;
      album: string | null;
      releaseDate: string | null;
      year: number | null;
      discNumber: number | null;
      trackNumber: number | null;
    }>(
      sql`SELECT i.id AS itemId, i.track_id AS trackId, i.yt_song AS stored, i.added_at AS addedAt,
      t.title, t.artist_credit AS artist, a.title AS album, t.release_date AS releaseDate, t.year,
      t.disc_number AS discNumber, t.track_number AS trackNumber
      ${listableEntries(id)} ORDER BY i.order_key, i.sync_id`,
    )
    .flatMap((entry) => {
      const { itemId, trackId, stored, addedAt } = entry;
      if (stored === null)
        return trackId === null
          ? []
          : [
              {
                title: entry.title ?? "",
                artist: entry.artist ?? "",
                album: entry.album ?? "",
                addedAt,
                releaseDate: released(entry) ?? null,
                discNumber: entry.discNumber,
                trackNumber: entry.trackNumber,
                song: { trackId, addedAt } as PlaylistSong,
              },
            ];
      const song = readPlaylistYtSong(stored);
      return song === null
        ? []
        : [
            {
              title: song.title,
              artist: joinArtists(song.artists),
              album: song.album ?? "",
              addedAt,
              song: { itemId, song, addedAt } as PlaylistSong,
            },
          ];
    })
    .map((entry, index) => ({ ...entry, song: { ...entry.song, order: index + 1 } }));
  return sortPlaylistSongs(entries, sort).map((entry) => entry.song);
};

/** The sort the playlist's page shows in, when it isn't the playlist's own order. */
const chosenSort = (db: LibraryDatabase, id: number): PlaylistSongSort | undefined => {
  const sort = playlistSongSort(db, id);
  return sort.key === "custom" ? undefined : sort;
};

/**
 * The playlist's songs as its page shows them, YT Music songs in their places, for starting
 * playback; undefined when `browseTrackIds` gives the same (a playlist of files in its own order).
 */
export const playlistSongs = (db: LibraryDatabase, id: number): PlaylistSong[] | undefined => {
  const sort = chosenSort(db, id);
  if (sort !== undefined) return sortedEntries(db, id, sort);
  return hasStoredEntries(db, id) ? orderedEntries(db, listableEntries(id)) : undefined;
};

/** The saved list an artist's Popular sort ranks by: YouTube Music's order of their songs. */
const popularSongs = (db: LibraryDatabase, artistId: number): readonly YtSong[] | null => {
  const name = db.get<{ name: string }>(sql`SELECT name FROM artists WHERE id=${artistId}`)?.name;
  if (name === undefined) return null;
  return artistPopularSongs(
    stepYtArtistSection<YtAlbumSong>(YT_ARTIST_SECTION_START, {
      type: "restored",
      saved: selectYtArtist<YtAlbumSong>(db, identityKey(name)),
    }),
  );
};

/**
 * [songs] (an artist's, in song name order) as Popular shows them (Core's `artistSongOrder`),
 * each with its rank in `order`. Other sorts read the ranks of a page of rows the same way: a
 * song's rank doesn't depend on the songs around it.
 */
const ranked = (songs: readonly BrowseRow[], popular: readonly YtSong[]): BrowseRow[] =>
  artistSongOrder(
    songs.map((track) => ({ source: "library" as const, track })),
    popular,
    { sort: "popular", online: false },
  ).flatMap((song) =>
    song.source !== "library"
      ? []
      : [song.popularRank === undefined ? song.track : { ...song.track, order: song.popularRank }],
  );

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
  return songs.flatMap((song): BrowseRow[] => {
    const found =
      "trackId" in song ? tracks.get(song.trackId) : { ...ytRow(song.song), id: -song.itemId };
    if (found === undefined) return [];
    return [
      {
        ...found,
        ...(song.addedAt === undefined ? {} : { addedAt: song.addedAt }),
        ...(song.order === undefined ? {} : { order: song.order }),
      },
    ];
  });
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
  const sort = readBrowseSort(db, scope.kind);
  const { source, order } = listing(scope, sort);
  const playlist = scope.kind === "playlist" ? scope.id : undefined;
  const ownSort = playlist === undefined ? undefined : playlistSongSort(db, playlist);
  const popular =
    scope.kind === "artist" && scope.id !== undefined ? popularSongs(db, scope.id) : null;
  let total: number;
  let items: BrowseRow[];
  if (playlist !== undefined && ownSort !== undefined && ownSort.key !== "custom") {
    const sorted = sortedEntries(db, playlist, ownSort);
    total = sorted.length;
    items = playlistRows(db, sorted.slice(offset, offset + limit), keepStreams);
  } else if (popular !== null && sort?.key === "popular") {
    // Popular isn't an order SQLite has: the artist's songs are read whole and ranked.
    const songs = ranked(
      db.all<BrowseRow>(sql`SELECT * FROM (${source}) ORDER BY ${order}`).map(row),
      popular,
    );
    total = songs.length;
    items = songs.slice(offset, offset + limit);
  } else {
    const mixed =
      playlist !== undefined && hasStoredEntries(db, playlist)
        ? listableEntries(playlist)
        : undefined;
    total = db.get<{ count: number }>(
      mixed
        ? sql`SELECT count(*) AS count ${mixed}`
        : sql`SELECT count(*) AS count FROM (${source})`,
    )!.count;
    const page = sql`LIMIT ${limit} OFFSET ${offset}`;
    items = mixed
      ? playlistRows(db, orderedEntries(db, mixed, page), keepStreams)
      : db.all<BrowseRow>(sql`SELECT * FROM (${source}) ORDER BY ${order} ${page}`).map(row);
    // A playlist in its own order: each row's place is where it shows.
    if (playlist !== undefined)
      items = items.map((item, index) => ({
        ...item,
        order: offset + index + 1,
        addedAt: (item as { entryAddedAt?: number }).entryAddedAt ?? item.addedAt,
      }));
    else if (popular !== null) {
      const ranks = new Map(ranked(items, popular).map((song) => [song.id, song.order]));
      items = items.map((item) => {
        const rank = ranks.get(item.id);
        return rank === undefined ? item : { ...item, order: rank };
      });
    }
  }
  if (playlist !== undefined)
    items = items.map((item) => {
      const date = released(item as { releaseDate?: string | null; year: number | null });
      return date === undefined ? item : { ...item, released: date };
    });
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
  const shown = ownSort ?? sort;
  return { items, offset, total, ...(hero ? { hero } : {}), ...(shown ? { sort: shown } : {}) };
};

export const browseLetter = (
  db: LibraryDatabase,
  scope: BrowseScope,
  letter: string,
): number | null => {
  const sort = readBrowseSort(db, scope.kind);
  const spine =
    // A song list files under what it's sorted by; Popular and the dates have no letters.
    ["songs", "favorites", "artist", "genre"].includes(scope.kind)
      ? sort && songBrowseSpine(sort)
      : scope.kind === "album" || scope.kind === "playlist" || scope.kind === "search"
        ? undefined
        : sql`sort`;
  if (spine === undefined) return null;
  const { source, order } = listing(scope, sort);
  const comparison = sort?.descending ? sql`<=` : sql`>=`;
  return (
    db.get<{ position: number }>(sql`SELECT position FROM (
    SELECT ${spine} AS nameKey, row_number() OVER (ORDER BY ${order}) - 1 AS position FROM (${source})
    ) WHERE substr(nameKey,1,1) ${comparison} wave_sort_key(${letter}) ORDER BY position LIMIT 1`)
      ?.position ?? 0
  );
};

/**
 * The row ids of a page whose order SQLite can't give (a sorted playlist, an artist's Popular),
 * as the page shows them: a streamed entry's is its entry id negated. Undefined when the list's
 * own query orders it.
 */
export const arrangedRowIds = (db: LibraryDatabase, scope: BrowseScope): number[] | undefined => {
  if (scope.id === undefined) return undefined;
  if (scope.kind === "playlist") {
    const sort = chosenSort(db, scope.id);
    return sort === undefined
      ? undefined
      : sortedEntries(db, scope.id, sort).map((entry) =>
          "trackId" in entry ? entry.trackId : -entry.itemId,
        );
  }
  if (scope.kind !== "artist") return undefined;
  const sort = readBrowseSort(db, "artist");
  const popular = sort?.key === "popular" ? popularSongs(db, scope.id) : null;
  if (popular === null) return undefined;
  const { source, order } = listing(scope, sort);
  return ranked(
    db.all<BrowseRow>(sql`SELECT * FROM (${source}) ORDER BY ${order}`).map(row),
    popular,
  ).map((song) => song.id);
};

/**
 * The ids of [scope]'s Library songs, in the order its list shows them; none for a list of lists.
 * A playlist's YT Music songs aren't among them (`playlistSongs` has those).
 */
export const browseTrackIds = (db: LibraryDatabase, scope: BrowseScope): string[] => {
  if (["albums", "artists", "playlists", "genres"].includes(scope.kind)) return [];
  if (scope.kind === "search") return searchSongIds(db, scope.query ?? "").map(String);
  // A streamed entry (a negative row id) is no Library song.
  const arranged = arrangedRowIds(db, scope);
  if (arranged !== undefined) return arranged.filter((id) => id > 0).map(String);
  const { source, order } = listing(scope, readBrowseSort(db, scope.kind));
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
