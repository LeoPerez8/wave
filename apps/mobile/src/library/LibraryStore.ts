import {
  artistAlbums,
  checkPlaylistName,
  compareAlbumTracks,
  compareFileNames,
  compareStrings,
  filesLeavingWithRoot,
  rememberSearch,
  moveItem,
  planPlaylistAdd,
  playlistMosaic,
  sortKey,
  type IndexedFile,
  type LibraryTrack,
  type CreditedPlayTotals,
  type PlayEvent,
  type PlayTotals,
  type SongListening,
  type StatsWindow,
} from "@wave/core";
import { asc, desc, eq, inArray, ne, or, sql, type SQL } from "drizzle-orm";
import { drizzle, type ExpoSQLiteDatabase } from "drizzle-orm/expo-sqlite";
import { migrate } from "drizzle-orm/expo-sqlite/migrator";
import type { SQLiteColumn } from "drizzle-orm/sqlite-core";
import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { openDatabaseSync } from "expo-sqlite";

import { selectAlbums } from "./db/albums";
import {
  refreshArtistImages,
  selectArtistCovers,
  selectArtistSongs,
  selectArtists,
} from "./db/artists";
import {
  clearArtistPhotos,
  recordArtistPhoto,
  selectArtistPhotoLookups,
  selectArtistPhotos,
  type ArtistPhotoLookup,
  type ArtistPhotoRecord,
  type ArtistPhotoRow,
} from "./db/artistPhotos";
import { libraryCounts, sectionSongCounts, type LibraryCounts } from "./db/counts";
import { selectGenreSongs } from "./db/genres";
import type { RowPage } from "./db/database";
import migrations from "./db/migrations";
import { selectLinkRows, type LinkIds, type LinkRows } from "./db/links";
import {
  homeSections,
  latestPlay,
  listFavorites,
  recordPlay,
  setFavorites,
  updatePlay,
  type FavoriteRow,
  type HomeSections,
  type RecordedPlay,
} from "./db/playHistory";
import {
  insertPlaylistItems,
  removePlaylistItems,
  replacePlaylistSongs,
  selectPlaylistSongs,
  selectTrackPaths,
} from "./db/playlists";
import * as schema from "./db/schema";
import {
  BY_TITLE,
  deleteTracks,
  selectKnownFiles,
  selectLibraryLookupSongs,
  trackQuery,
} from "./db/tracks";
import { creditedPlayTotals, songListening, trackPlayTotals } from "./db/stats";
import type { KnownFile } from "./NativeScanner";

const DATABASE_NAME = "wave.db";

export class LibraryStoreError extends Data.TaggedError("LibraryStoreError")<{
  readonly operation: string;
  readonly cause: unknown;
}> {
  override get message(): string {
    return `Library store failed to ${this.operation}: ${String(this.cause)}`;
  }
}

/** A track as the scanner reported it, after Core normalisation. */
export interface IndexedTrack extends LibraryTrack {
  readonly sizeBytes: number;
  readonly modifiedAt: number;
  readonly sampleRate: number | null;
  readonly bitrateKbps: number | null;
  readonly artworkHash: string | null;
  /** Lyrics in its tags or a sidecar `.lrc`. */
  readonly hasLyrics: boolean;
}

export interface IndexedArtwork {
  readonly hash: string;
  readonly path: string;
  readonly thumbPath: string;
  readonly palette: schema.ArtworkPalette;
}

export interface ScanRoot {
  readonly path: string;
  readonly isDefault: boolean;
  readonly lastScannedAt: number | null;
}

/** A scan root with the number of indexed tracks under it, for Music folders. */
export interface ScanRootSummary extends ScanRoot {
  readonly trackCount: number;
}

/** A song as the whole-Library lyrics and genre run sees it (Core's `libraryLookupSongs`). */
export interface LibraryLookupSong {
  readonly path: string;
  readonly title: string;
  readonly artist: string;
  readonly album: string;
  readonly durationMs: number;
  readonly genre: string | null;
  readonly hasLyrics: boolean;
}

/** One row of the Songs list. */
export interface SongRow {
  readonly id: number;
  readonly path: string;
  readonly title: string;
  readonly artist: string;
  readonly album: string;
  readonly durationMs: number;
  readonly thumbPath: string | null;
  readonly artworkPath: string | null;
  /** Core sort key of the title (files the row on the A–Z spine). */
  readonly titleSort: string;
  /** Core sort keys of the artist and album, for sorting song lists. */
  readonly artistSort: string;
  readonly albumSort: string;
  /** When the file entered the library (epoch ms). */
  readonly addedAt: number;
  readonly albumId: number;
  /** The track artist. */
  readonly artistId: number;
  /** Orders the album's tracks, and so sorts by artist and by album. */
  readonly discNumber: number | null;
  readonly trackNumber: number | null;
}

/** A track on an album screen, with what orders it there. */
export type AlbumTrackRow = SongRow;

export type { FavoriteRow };

/** One album of the Albums grid (and of an artist's albums). */
export interface AlbumRow {
  readonly id: number;
  readonly title: string;
  readonly titleSort: string;
  readonly albumArtist: string;
  readonly albumArtistId: number;
  readonly year: number | null;
  readonly compilation: boolean;
  readonly trackCount: number;
  readonly durationMs: number;
  readonly thumbPath: string | null;
  readonly artworkPath: string | null;
}

/** One row of the Artists list: track artists and album artists alike. */
export interface ArtistRow {
  readonly id: number;
  readonly name: string;
  readonly sort: string;
  /** Albums filed under the artist. */
  readonly albumCount: number;
  /** Songs by the artist or on their albums. */
  readonly trackCount: number;
  /**
   * The artist's image (an album cover, Core's `artistArtwork`): thumbnail for
   * rows, full size for the artist page; null for the initial placeholder.
   */
  readonly thumbPath: string | null;
  readonly artworkPath: string | null;
}

export interface GenreRow {
  readonly id: number;
  readonly name: string;
  readonly sort: string;
  readonly trackCount: number;
}

/** A folder that holds tracks, for Library › Folders. */
export interface FolderRow {
  readonly id: number;
  readonly name: string;
  readonly path: string;
  /** Core sort key of the name. */
  readonly sort: string;
  readonly trackCount: number;
}

export interface AlbumDetail {
  readonly album: AlbumRow;
  /** The genre most of the album's tracks carry. */
  readonly genre: string | null;
  /** By disc, then track number (Core's `compareAlbumTracks`). */
  readonly tracks: readonly AlbumTrackRow[];
}

export interface ArtistDetail {
  readonly artist: ArtistRow;
  /** Filed under the artist, newest first. */
  readonly albums: readonly AlbumRow[];
  /** Other albums with songs by the artist (compilations…), newest first. */
  readonly appearsOn: readonly AlbumRow[];
  /** By title. */
  readonly songs: readonly SongRow[];
}

export interface GenreDetail {
  readonly genre: GenreRow;
  /** By title. */
  readonly songs: readonly SongRow[];
}

export interface FolderDetail {
  readonly folder: FolderRow;
  /** By file name, the way a file manager lists them. */
  readonly songs: readonly SongRow[];
}

/** An indexed file found under a new path (see Core's `reconcileScan`). */
export interface PathMove {
  readonly from: string;
  readonly to: string;
}

/** The queue and position saved for the next launch. */
export interface SavedPlayback {
  /** Core's `QueueState` as JSON. */
  readonly queue: string;
  readonly positionMs: number;
}

/** What Now Playing shows about a track beyond the player's item. */
export interface TrackDetails {
  readonly id: number;
  readonly artistId: number;
  readonly artist: string;
  readonly albumId: number;
  readonly album: string;
  readonly palette: schema.ArtworkPalette | null;
  /** The audio file, for reading its lyrics. */
  readonly path: string;
}

/** One playlist of Library › Playlists. */
export interface PlaylistRow {
  readonly id: number;
  readonly name: string;
  /** Core sort key of the name. */
  readonly sort: string;
  readonly trackCount: number;
  readonly durationMs: number;
  /** Thumbnails of its mosaic (Core's `playlistMosaic`): none, one or four. */
  readonly thumbPaths: readonly string[];
  /** Full-size covers of the same mosaic, for the playlist screen's header. */
  readonly artworkPaths: readonly string[];
}

/** A song in a playlist; the same track may only appear once. */
export interface PlaylistItemRow extends SongRow {
  readonly itemId: number;
}

export interface PlaylistDetail {
  readonly playlist: PlaylistRow;
  /** In playlist order. */
  readonly items: readonly PlaylistItemRow[];
}

/** What adding songs to a playlist did. */
export interface PlaylistAddResult {
  readonly playlistId: number;
  readonly name: string;
  readonly added: number;
  readonly alreadyIn: number;
}

export class LibraryStore extends Context.Service<
  LibraryStore,
  {
    /** Adds [path] as a scan root when there are no roots yet; returns the roots. */
    readonly ensureDefaultRoot: (
      path: string,
    ) => Effect.Effect<readonly ScanRoot[], LibraryStoreError>;
    /** Every scan root in the order it was added, with its track count. */
    readonly listRoots: Effect.Effect<readonly ScanRootSummary[], LibraryStoreError>;
    /**
     * Adds [path] as a root the owner picked and removes the roots in [drop]
     * (see Core's `planAddRoot`). No root is a default one afterwards.
     */
    readonly addRoot: (
      path: string,
      drop: readonly string[],
    ) => Effect.Effect<void, LibraryStoreError>;
    /**
     * Removes a root and the tracks no other root covers, then the albums,
     * artists, genres and folders left without tracks. The last root can't be removed.
     */
    readonly removeRoot: (path: string) => Effect.Effect<void, LibraryStoreError>;
    readonly excludedFolders: Effect.Effect<readonly string[], LibraryStoreError>;
    /**
     * Upserts one scanner batch (and the artwork it references) in a single
     * transaction. [moves] first re-point indexed tracks to the paths they were
     * found under, so they keep their id (and with it history and favorites).
     */
    readonly saveBatch: (
      tracks: readonly IndexedTrack[],
      artwork: readonly IndexedArtwork[],
      moves?: readonly PathMove[],
    ) => Effect.Effect<void, LibraryStoreError>;
    readonly markScanned: (
      roots: readonly string[],
      at: number,
    ) => Effect.Effect<void, LibraryStoreError>;
    readonly countTracks: Effect.Effect<number, LibraryStoreError>;
    /** How many items each Library entry holds, for the Library tab. */
    readonly countLibrary: Effect.Effect<LibraryCounts, LibraryStoreError>;
    /** How many songs each Library entry's menu acts on, for its heading. */
    readonly countSectionSongs: Effect.Effect<LibraryCounts, LibraryStoreError>;
    /** Every track ordered by title, for Library › Songs. */
    readonly listSongs: Effect.Effect<readonly SongRow[], LibraryStoreError>;
    /**
     * Every song with what a lyrics and genre lookup sends, its genre and
     * whether it has lyrics, for the whole-Library run.
     */
    readonly listLibraryLookupSongs: Effect.Effect<
      readonly LibraryLookupSong[],
      LibraryStoreError
    >;
    /** Every album by title, then album artist, for Library › Albums. */
    readonly listAlbums: Effect.Effect<readonly AlbumRow[], LibraryStoreError>;
    /** [page] of the albums in the same order, for lists that page (Auto). */
    readonly listAlbumsPage: (
      page: RowPage,
    ) => Effect.Effect<readonly AlbumRow[], LibraryStoreError>;
    /** Every artist with songs, by name, for Library › Artists. */
    readonly listArtists: Effect.Effect<readonly ArtistRow[], LibraryStoreError>;
    /** [page] of the artists in the same order, for lists that page (Auto). */
    readonly listArtistsPage: (
      page: RowPage,
    ) => Effect.Effect<readonly ArtistRow[], LibraryStoreError>;
    /** [page] of an artist's songs, in their screen's order (by title), for Auto. */
    readonly listArtistSongsPage: (
      id: number,
      page: RowPage,
    ) => Effect.Effect<readonly SongRow[], LibraryStoreError>;
    /** [page] of a playlist's songs, in playlist order, for Auto. */
    readonly listPlaylistSongsPage: (
      id: number,
      page: RowPage,
    ) => Effect.Effect<readonly SongRow[], LibraryStoreError>;
    /** A cover for each of [ids] that has one (an album or song of theirs), for Auto. */
    readonly artistCovers: (
      ids: readonly number[],
    ) => Effect.Effect<ReadonlyMap<number, string>, LibraryStoreError>;
    /** Every genre with songs, by name, for Library › Genres. */
    readonly listGenres: Effect.Effect<readonly GenreRow[], LibraryStoreError>;
    /** Every folder holding songs, by name, for Library › Folders. */
    readonly listFolders: Effect.Effect<readonly FolderRow[], LibraryStoreError>;
    /** An album and its tracks, or null when it's no longer in the library. */
    readonly getAlbum: (id: number) => Effect.Effect<AlbumDetail | null, LibraryStoreError>;
    readonly getArtist: (id: number) => Effect.Effect<ArtistDetail | null, LibraryStoreError>;
    readonly getGenre: (id: number) => Effect.Effect<GenreDetail | null, LibraryStoreError>;
    readonly getFolder: (id: number) => Effect.Effect<FolderDetail | null, LibraryStoreError>;

    /** The indexed files under [roots], for an incremental scan to skip the unchanged ones. */
    readonly knownFiles: (
      roots: readonly string[],
    ) => Effect.Effect<readonly KnownFile[], LibraryStoreError>;
    /** What identifies the indexed files at [paths] when they turn up elsewhere. */
    readonly indexedFiles: (
      paths: readonly string[],
    ) => Effect.Effect<readonly IndexedFile[], LibraryStoreError>;
    /**
     * Removes the tracks at [paths], then the albums, artists, genres and
     * folders left without tracks (also after tag changes, so call it once per scan).
     */
    readonly removeTracks: (paths: readonly string[]) => Effect.Effect<void, LibraryStoreError>;
    /** Excludes [path] and drops the exclusions in [drop] (see Core's `planExclusion`). */
    readonly addExcludedFolder: (
      path: string,
      drop: readonly string[],
    ) => Effect.Effect<void, LibraryStoreError>;
    readonly removeExcludedFolder: (path: string) => Effect.Effect<void, LibraryStoreError>;
    /** The tracks with these ids, in no particular order; ids no longer indexed are left out. */
    readonly songsByIds: (
      ids: readonly number[],
    ) => Effect.Effect<readonly SongRow[], LibraryStoreError>;
    readonly loadPlayback: Effect.Effect<SavedPlayback | null, LibraryStoreError>;
    /** Saves the queue with where its current entry is. */
    readonly saveQueue: (
      queue: string,
      positionMs: number,
    ) => Effect.Effect<void, LibraryStoreError>;
    readonly savePosition: (positionMs: number) => Effect.Effect<void, LibraryStoreError>;
    /** The playing track's links and artwork palette, for Now Playing; null once it's gone. */
    readonly trackDetails: (id: number) => Effect.Effect<TrackDetails | null, LibraryStoreError>;
    /** The recent searches, newest first. */
    readonly listRecentSearches: Effect.Effect<readonly string[], LibraryStoreError>;
    /** Adds a search to the recent ones (see Core's `rememberSearch`); returns them, newest first. */
    readonly rememberSearch: (query: string) => Effect.Effect<readonly string[], LibraryStoreError>;
    readonly clearRecentSearches: Effect.Effect<void, LibraryStoreError>;
    /** Every playlist by name, with its mosaic. */
    readonly listPlaylists: Effect.Effect<readonly PlaylistRow[], LibraryStoreError>;
    readonly getPlaylist: (id: number) => Effect.Effect<PlaylistDetail | null, LibraryStoreError>;
    /**
     * Creates a playlist holding [trackIds] (Core's `checkPlaylistName` must
     * accept the name, or it fails).
     */
    readonly createPlaylist: (
      name: string,
      trackIds: readonly number[],
    ) => Effect.Effect<PlaylistAddResult, LibraryStoreError>;
    readonly renamePlaylist: (id: number, name: string) => Effect.Effect<void, LibraryStoreError>;
    readonly deletePlaylist: (id: number) => Effect.Effect<void, LibraryStoreError>;
    /** Appends the tracks the playlist doesn't have yet (Core's `planPlaylistAdd`). */
    readonly addToPlaylist: (
      id: number,
      trackIds: readonly number[],
    ) => Effect.Effect<PlaylistAddResult, LibraryStoreError>;
    /** Moves an item to [toIndex] (0-based) in its playlist. */
    readonly movePlaylistItem: (
      playlistId: number,
      itemId: number,
      toIndex: number,
    ) => Effect.Effect<void, LibraryStoreError>;
    /** Removes these entries from the playlist (other copies of the same songs stay). */
    readonly removePlaylistItems: (
      playlistId: number,
      itemIds: readonly number[],
    ) => Effect.Effect<void, LibraryStoreError>;
    /** Makes the playlist hold exactly [trackIds], in that order (an import's Replace). */
    readonly replacePlaylistSongs: (
      playlistId: number,
      trackIds: readonly number[],
    ) => Effect.Effect<void, LibraryStoreError>;
    /** Every track's id and file path, for matching an imported playlist's entries. */
    readonly trackPaths: Effect.Effect<
      readonly { readonly id: number; readonly path: string }[],
      LibraryStoreError
    >;
    /** The ids of every starred track. */
    readonly favoriteTrackIds: Effect.Effect<readonly number[], LibraryStoreError>;
    /** Stars (or unstars) the tracks; those starred already keep when they were starred. */
    readonly setFavorites: (
      trackIds: readonly number[],
      on: boolean,
    ) => Effect.Effect<void, LibraryStoreError>;
    /** Starred tracks, most recently starred first, for Library › Favorites. */
    readonly listFavorites: Effect.Effect<readonly FavoriteRow[], LibraryStoreError>;
    /** Records a play as it starts (Core's `PlayEvent`); returns its id, to update it as it goes on. */
    readonly recordPlay: (play: PlayEvent) => Effect.Effect<number, LibraryStoreError>;
    /** Brings a recorded play up to date: listened time, how it ended (so far), counted. */
    readonly updatePlay: (id: number, play: PlayEvent) => Effect.Effect<void, LibraryStoreError>;
    /** The Home tab: Recently Added, Recently Played, Most Played and Favorites. */
    readonly home: Effect.Effect<HomeSections, LibraryStoreError>;
    /** The play recorded last, to pick back up when JS restarts while the player kept going. */
    readonly latestPlay: Effect.Effect<RecordedPlay | null, LibraryStoreError>;
    /** Each track's counted plays within [window] (tracks still in the library), in no order. */
    readonly trackPlayTotals: (
      window: StatsWindow,
    ) => Effect.Effect<readonly PlayTotals[], LibraryStoreError>;
    /**
     * Counted plays within [window] per album and track artist (deleted songs
     * included), in no order; Core's `albumPlayTotals` / `artistPlayTotals` group them.
     */
    readonly creditedPlayTotals: (
      window: StatsWindow,
    ) => Effect.Effect<readonly CreditedPlayTotals[], LibraryStoreError>;
    /** The albums with these ids, in no particular order; albums no longer in the library are left out. */
    readonly albumsByIds: (
      ids: readonly number[],
    ) => Effect.Effect<readonly AlbumRow[], LibraryStoreError>;
    /** The artists with these ids, in no particular order; artists without songs are left out. */
    readonly artistsByIds: (
      ids: readonly number[],
    ) => Effect.Effect<readonly ArtistRow[], LibraryStoreError>;
    /** The album and artist rows behind links to them, read ahead of a tap (`db/links.ts`). */
    readonly linkRows: (ids: LinkIds) => Effect.Effect<LinkRows, LibraryStoreError>;
    /**
     * Each played song's all-time listening (every play's time, counted plays,
     * latest play, track artist), in no order; Core's `listeningTotals` sums it.
     */
    readonly songListening: Effect.Effect<readonly SongListening[], LibraryStoreError>;
    /** The artists whose photo is due for a lookup now (Core's `artistPhotoLookups`). */
    readonly artistPhotoLookups: Effect.Effect<readonly ArtistPhotoLookup[], LibraryStoreError>;
    /** Records how an artist's photo lookup went, by artist key. */
    readonly recordArtistPhoto: (
      artistKey: string,
      record: ArtistPhotoRecord,
    ) => Effect.Effect<void, LibraryStoreError>;
    /** Every downloaded artist photo. */
    readonly listArtistPhotos: Effect.Effect<readonly ArtistPhotoRow[], LibraryStoreError>;
    /** Forgets every artist photo and miss (the files are deleted by the caller). */
    readonly clearArtistPhotos: Effect.Effect<void, LibraryStoreError>;
  }
>()("@wave/mobile/library/LibraryStore") {}

type Database = ExpoSQLiteDatabase<typeof schema>;

/** `excluded.<column>` in an upsert's DO UPDATE clause. */
const excluded = (column: SQLiteColumn): SQL => sql.raw(`excluded."${column.name}"`);

const basename = (path: string): string => path.slice(path.lastIndexOf("/") + 1) || path;

const uniqueBy = <A>(items: Iterable<A>, key: (item: A) => string): A[] => {
  const seen = new Map<string, A>();
  for (const item of items) if (!seen.has(key(item))) seen.set(key(item), item);
  return [...seen.values()];
};

const idMap = (rows: readonly { id: number; key: string }[]): Map<string, number> =>
  new Map(rows.map((row) => [row.key, row.id]));

const requireId = (ids: Map<string, number>, key: string, kind: string): number => {
  const id = ids.get(key);
  if (id === undefined) throw new Error(`Missing ${kind} id for ${key}`);
  return id;
};

const saveBatchSync = (
  db: Database,
  tracks: readonly IndexedTrack[],
  artworkRows: readonly IndexedArtwork[],
  moves: readonly PathMove[],
  now: number,
): void => {
  const { artists, genres, folders, albums, artwork } = schema;
  db.transaction((tx) => {
    // The upsert below then updates the moved rows by their new path.
    for (const move of moves) {
      tx.update(schema.tracks)
        .set({ path: move.to })
        .where(eq(schema.tracks.path, move.from))
        .run();
    }
    if (artworkRows.length > 0) {
      tx.insert(artwork)
        .values(artworkRows.map((row) => ({ ...row })))
        .onConflictDoUpdate({
          target: artwork.hash,
          set: {
            path: excluded(artwork.path),
            thumbPath: excluded(artwork.thumbPath),
            palette: excluded(artwork.palette),
          },
        })
        .run();
    }
    if (tracks.length === 0) return;

    const artistRows = uniqueBy(
      tracks.flatMap((t) => [
        { key: t.artistKey, name: t.artist, sort: t.artistSort },
        { key: t.albumArtistKey, name: t.albumArtist, sort: t.albumArtistSort },
      ]),
      (row) => row.key,
    );
    const artistIds = idMap(
      tx
        .insert(artists)
        .values(artistRows)
        .onConflictDoUpdate({
          target: artists.key,
          set: { name: excluded(artists.name), sort: excluded(artists.sort) },
        })
        .returning({ id: artists.id, key: artists.key })
        .all(),
    );

    const genreRows = uniqueBy(
      tracks.flatMap((t) =>
        t.genre !== null && t.genreKey !== null && t.genreSort !== null
          ? [{ key: t.genreKey, name: t.genre, sort: t.genreSort }]
          : [],
      ),
      (row) => row.key,
    );
    const genreIds =
      genreRows.length === 0
        ? new Map<string, number>()
        : idMap(
            tx
              .insert(genres)
              .values(genreRows)
              .onConflictDoUpdate({
                target: genres.key,
                set: { name: excluded(genres.name), sort: excluded(genres.sort) },
              })
              .returning({ id: genres.id, key: genres.key })
              .all(),
          );

    const folderRows = uniqueBy(
      tracks.map((t) => ({ path: t.folder, name: basename(t.folder) })),
      (row) => row.path,
    );
    const folderIds = new Map(
      tx
        .insert(folders)
        .values(folderRows)
        .onConflictDoUpdate({ target: folders.path, set: { name: excluded(folders.name) } })
        .returning({ id: folders.id, path: folders.path })
        .all()
        .map((row) => [row.path, row.id] as const),
    );

    const albumRows = uniqueBy(
      tracks.map((t) => ({
        key: t.albumKey,
        title: t.album,
        titleSort: t.albumSort,
        albumArtistId: requireId(artistIds, t.albumArtistKey, "artist"),
        year: t.year,
        artworkHash: t.artworkHash,
        compilation: t.compilation,
      })),
      (row) => row.key,
    );
    const albumIds = idMap(
      tx
        .insert(albums)
        .values(albumRows)
        .onConflictDoUpdate({
          target: albums.key,
          set: {
            title: excluded(albums.title),
            titleSort: excluded(albums.titleSort),
            // The first track that has a year or a cover gives it to the album.
            year: sql`coalesce(${albums.year}, ${excluded(albums.year)})`,
            artworkHash: sql`coalesce(${albums.artworkHash}, ${excluded(albums.artworkHash)})`,
            compilation: sql`${albums.compilation} or ${excluded(albums.compilation)}`,
          },
        })
        .returning({ id: albums.id, key: albums.key })
        .all(),
    );

    const t = schema.tracks;
    tx.insert(t)
      .values(
        tracks.map((track) => ({
          path: track.path,
          folderId: requireId(folderIds, track.folder, "folder"),
          fileName: track.fileName,
          sizeBytes: track.sizeBytes,
          modifiedAt: track.modifiedAt,
          title: track.title,
          titleSort: track.titleSort,
          artistId: requireId(artistIds, track.artistKey, "artist"),
          albumId: requireId(albumIds, track.albumKey, "album"),
          genreId: track.genreKey === null ? null : (genreIds.get(track.genreKey) ?? null),
          year: track.year,
          trackNumber: track.trackNumber,
          trackTotal: track.trackTotal,
          discNumber: track.discNumber,
          discTotal: track.discTotal,
          durationMs: track.durationMs,
          sampleRate: track.sampleRate,
          bitrateKbps: track.bitrateKbps,
          artworkHash: track.artworkHash,
          hasLyrics: track.hasLyrics,
          addedAt: now,
          scannedAt: now,
        })),
      )
      .onConflictDoUpdate({
        target: t.path,
        // Everything but added_at, which keeps the first time the file was seen.
        set: {
          folderId: excluded(t.folderId),
          fileName: excluded(t.fileName),
          sizeBytes: excluded(t.sizeBytes),
          modifiedAt: excluded(t.modifiedAt),
          title: excluded(t.title),
          titleSort: excluded(t.titleSort),
          artistId: excluded(t.artistId),
          albumId: excluded(t.albumId),
          genreId: excluded(t.genreId),
          year: excluded(t.year),
          trackNumber: excluded(t.trackNumber),
          trackTotal: excluded(t.trackTotal),
          discNumber: excluded(t.discNumber),
          discTotal: excluded(t.discTotal),
          durationMs: excluded(t.durationMs),
          sampleRate: excluded(t.sampleRate),
          bitrateKbps: excluded(t.bitrateKbps),
          artworkHash: excluded(t.artworkHash),
          hasLyrics: excluded(t.hasLyrics),
          scannedAt: excluded(t.scannedAt),
        },
      })
      .run();
  });
};

/** SQLite's default limit on bound parameters is far above this; it keeps statements small. */
const DELETE_CHUNK = 500;

const chunks = <A>(items: readonly A[]): A[][] => {
  const result: A[][] = [];
  for (let i = 0; i < items.length; i += DELETE_CHUNK) {
    result.push(items.slice(i, i + DELETE_CHUNK));
  }
  return result;
};

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

/**
 * Deletes the albums, artists, genres and folders no track uses any more, then
 * re-picks the artists' images from the albums left.
 */
const pruneOrphans = (tx: Transaction): void => {
  // Albums first: they hold the album artist.
  tx.run(sql`DELETE FROM albums WHERE id NOT IN (SELECT album_id FROM tracks)`);
  tx.run(sql`DELETE FROM artists WHERE id NOT IN (SELECT artist_id FROM tracks)
    AND id NOT IN (SELECT album_artist_id FROM albums)`);
  tx.run(sql`DELETE FROM genres
    WHERE id NOT IN (SELECT genre_id FROM tracks WHERE genre_id IS NOT NULL)`);
  tx.run(sql`DELETE FROM folders WHERE id NOT IN (SELECT folder_id FROM tracks)`);
  refreshArtistImages(tx);
};

const removeTracksSync = (db: Database, paths: readonly string[]): void => {
  db.transaction((tx) => {
    deleteTracks(tx, paths);
    pruneOrphans(tx);
  });
};

const removeRootSync = (db: Database, path: string): void => {
  const { scanRoots, tracks, excludedFolders } = schema;
  db.transaction((tx) => {
    const remaining = tx
      .select({ path: scanRoots.path })
      .from(scanRoots)
      .all()
      .map((root) => root.path)
      .filter((root) => root !== path);
    if (remaining.length === 0) throw new Error("Wave needs at least one music folder");

    const under = tx
      .select({ path: tracks.path })
      .from(tracks)
      // SQLite counts characters where JS counts UTF-16 units, so the length is taken in SQL.
      .where(sql`substr(${tracks.path}, 1, length(${path}) + 1) = ${`${path}/`}`)
      .all()
      .map((row) => row.path);
    const leaving = filesLeavingWithRoot(under, path, remaining);
    deleteTracks(tx, leaving);
    tx.delete(scanRoots).where(eq(scanRoots.path, path)).run();

    // Exclusions only mean something inside a root.
    const exclusions = tx
      .select({ path: excludedFolders.path })
      .from(excludedFolders)
      .all()
      .map((row) => row.path);
    const stale = filesLeavingWithRoot(exclusions, path, remaining);
    if (stale.length > 0) {
      tx.delete(excludedFolders)
        .where(inArray(excludedFolders.path, [...stale]))
        .run();
    }

    pruneOrphans(tx);
  });
};

/** Artists with songs (see `selectArtists`), only [ids] if given. */
const listArtistsSync = (db: Database, ids?: readonly number[]): ArtistRow[] =>
  selectArtists(db, { ids });

const getAlbumSync = (db: Database, id: number): AlbumDetail | null => {
  const { tracks, genres } = schema;
  const album = selectAlbums(db, eq(schema.albums.id, id))[0];
  if (album === undefined) return null;
  const genre = db
    .select({ name: genres.name })
    .from(tracks)
    .innerJoin(genres, eq(tracks.genreId, genres.id))
    .where(eq(tracks.albumId, id))
    .groupBy(genres.id)
    .orderBy(desc(sql`count(*)`), asc(genres.sort))
    .get();
  const rows = trackQuery(db).where(eq(tracks.albumId, id)).all();
  // oxlint-disable-next-line unicorn/no-array-sort -- sorts a fresh array; Hermes lacks toSorted
  return { album, genre: genre?.name ?? null, tracks: rows.sort(compareAlbumTracks) };
};

const getArtistSync = (db: Database, id: number): ArtistDetail | null => {
  const { artists, albums, tracks } = schema;
  const artist = db
    .select({
      id: artists.id,
      name: artists.name,
      sort: artists.sort,
      thumbPath: schema.artwork.thumbPath,
      artworkPath: schema.artwork.path,
    })
    .from(artists)
    .leftJoin(schema.artwork, eq(artists.artworkHash, schema.artwork.hash))
    .where(eq(artists.id, id))
    .get();
  if (artist === undefined) return null;
  const songs = selectArtistSongs(db, id);
  const split = artistAlbums(
    id,
    selectAlbums(
      db,
      or(
        eq(albums.albumArtistId, id),
        inArray(
          albums.id,
          db.select({ id: tracks.albumId }).from(tracks).where(eq(tracks.artistId, id)),
        ),
      ),
    ),
  );
  return {
    artist: { ...artist, albumCount: split.albums.length, trackCount: songs.length },
    albums: split.albums,
    appearsOn: split.appearsOn,
    songs,
  };
};

const getGenreSync = (db: Database, id: number): GenreDetail | null => {
  const { genres } = schema;
  const genre = db
    .select({ id: genres.id, name: genres.name, sort: genres.sort })
    .from(genres)
    .where(eq(genres.id, id))
    .get();
  if (genre === undefined) return null;
  const songs = selectGenreSongs(db, id);
  return { genre: { ...genre, trackCount: songs.length }, songs };
};

const getFolderSync = (db: Database, id: number): FolderDetail | null => {
  const { folders, tracks } = schema;
  const folder = db
    .select({ id: folders.id, name: folders.name, path: folders.path })
    .from(folders)
    .where(eq(folders.id, id))
    .get();
  if (folder === undefined) return null;
  const songs = trackQuery(db)
    .where(eq(tracks.folderId, id))
    .all()
    // oxlint-disable-next-line unicorn/no-array-sort -- sorts a fresh array; Hermes lacks toSorted
    .sort((a, b) => compareFileNames(a.fileName, b.fileName));
  return {
    folder: { ...folder, sort: sortKey(folder.name), trackCount: songs.length },
    songs,
  };
};

const listFoldersSync = (db: Database): FolderRow[] => {
  const { folders, tracks } = schema;
  return (
    db
      .select({
        id: folders.id,
        name: folders.name,
        path: folders.path,
        trackCount: sql<number>`count(${tracks.id})`,
      })
      .from(folders)
      .innerJoin(tracks, eq(tracks.folderId, folders.id))
      .groupBy(folders.id)
      .all()
      .map((folder) => ({ ...folder, sort: sortKey(folder.name) }))
      // oxlint-disable-next-line unicorn/no-array-sort -- sorts a fresh array; Hermes lacks toSorted
      .sort((a, b) => compareStrings(a.sort, b.sort) || compareStrings(a.path, b.path))
  );
};

const SAVED_PLAYBACK_ID = 1;

const listRecentSearchesSync = (db: Pick<Database, "select">): string[] =>
  db
    .select({ query: schema.recentSearches.query })
    .from(schema.recentSearches)
    .orderBy(desc(schema.recentSearches.searchedAt))
    .all()
    .map((row) => row.query);

/** Rewrites the list Core's `rememberSearch` returns, newest with the latest time. */
const rememberSearchSync = (db: Database, query: string, now: number): readonly string[] =>
  db.transaction((tx) => {
    const recent = listRecentSearchesSync(tx);
    const next = rememberSearch(recent, query);
    if (next === recent) return recent;
    tx.delete(schema.recentSearches).run();
    tx.insert(schema.recentSearches)
      .values(next.map((search, i) => ({ query: search, searchedAt: now - i })))
      .run();
    return next;
  });

interface PlaylistCovers {
  readonly thumbPaths: readonly string[];
  readonly artworkPaths: readonly string[];
}

const NO_COVERS: PlaylistCovers = { thumbPaths: [], artworkPaths: [] };

/** Each playlist's mosaic, from its songs' album covers in playlist order. */
const playlistCovers = (db: Database, playlistId?: number): Map<number, PlaylistCovers> => {
  const { playlistItems, tracks, albums, artwork } = schema;
  const rows = db
    .select({
      playlistId: playlistItems.playlistId,
      thumbPath: artwork.thumbPath,
      path: artwork.path,
    })
    .from(playlistItems)
    .innerJoin(tracks, eq(playlistItems.trackId, tracks.id))
    .innerJoin(albums, eq(tracks.albumId, albums.id))
    .leftJoin(artwork, eq(albums.artworkHash, artwork.hash))
    .where(playlistId === undefined ? undefined : eq(playlistItems.playlistId, playlistId))
    .orderBy(asc(playlistItems.playlistId), asc(playlistItems.position), asc(playlistItems.id))
    .all();
  const grouped = new Map<number, { thumbs: (string | null)[]; paths: (string | null)[] }>();
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

const listPlaylistsSync = (db: Database): PlaylistRow[] => {
  const { playlists, playlistItems, tracks } = schema;
  const covers = playlistCovers(db);
  return (
    db
      .select({
        id: playlists.id,
        name: playlists.name,
        trackCount: sql<number>`count(${tracks.id})`,
        durationMs: sql<number>`coalesce(sum(${tracks.durationMs}), 0)`,
      })
      .from(playlists)
      .leftJoin(playlistItems, eq(playlistItems.playlistId, playlists.id))
      .leftJoin(tracks, eq(playlistItems.trackId, tracks.id))
      .groupBy(playlists.id)
      .all()
      .map((row) => ({
        ...row,
        sort: sortKey(row.name),
        ...(covers.get(row.id) ?? NO_COVERS),
      }))
      // oxlint-disable-next-line unicorn/no-array-sort -- sorts a fresh array; Hermes lacks toSorted
      .sort((a, b) => compareStrings(a.sort, b.sort) || a.id - b.id)
  );
};

const getPlaylistSync = (db: Database, id: number): PlaylistDetail | null => {
  const { playlists } = schema;
  const playlist = db
    .select({ id: playlists.id, name: playlists.name })
    .from(playlists)
    .where(eq(playlists.id, id))
    .get();
  if (playlist === undefined) return null;
  const items = selectPlaylistSongs(db, id);
  const covers = playlistCovers(db, id).get(id) ?? NO_COVERS;
  return {
    playlist: {
      ...playlist,
      sort: sortKey(playlist.name),
      trackCount: items.length,
      durationMs: items.reduce((total, item) => total + item.durationMs, 0),
      thumbPaths: covers.thumbPaths,
      artworkPaths: covers.artworkPaths,
    },
    items,
  };
};

/** Fails with the reason when Core rejects the name. */
const requireName = (name: string, otherNames: readonly string[]): string => {
  const check = checkPlaylistName(name, otherNames);
  if (!check.ok) throw new Error(`Playlist name rejected (${check.problem})`);
  return check.name;
};

/** Appends the tracks the playlist doesn't have yet; returns how many went in and were skipped. */
const appendItems = (
  tx: Transaction,
  playlistId: number,
  trackIds: readonly number[],
  now: number,
): { added: number; alreadyIn: number } => {
  const { playlistItems } = schema;
  const existing = tx
    .select({ trackId: playlistItems.trackId })
    .from(playlistItems)
    .where(eq(playlistItems.playlistId, playlistId))
    .all()
    .map((row) => row.trackId);
  const plan = planPlaylistAdd(existing, trackIds);
  const last =
    tx
      .select({ position: sql<number | null>`max(${playlistItems.position})` })
      .from(playlistItems)
      .where(eq(playlistItems.playlistId, playlistId))
      .get()?.position ?? -1;
  const rows = plan.add.map((trackId, i) => ({
    playlistId,
    trackId,
    position: last + 1 + i,
    addedAt: now,
  }));
  insertPlaylistItems(tx, rows);
  return { added: plan.add.length, alreadyIn: plan.alreadyIn };
};

const createPlaylistSync = (
  db: Database,
  name: string,
  trackIds: readonly number[],
  now: number,
): PlaylistAddResult =>
  db.transaction((tx) => {
    const { playlists } = schema;
    const names = tx
      .select({ name: playlists.name })
      .from(playlists)
      .all()
      .map((row) => row.name);
    const stored = requireName(name, names);
    const created = tx
      .insert(playlists)
      .values({ name: stored, createdAt: now, updatedAt: now })
      .returning({ id: playlists.id })
      .get();
    return {
      playlistId: created.id,
      name: stored,
      ...appendItems(tx, created.id, trackIds, now),
    };
  });

const addToPlaylistSync = (
  db: Database,
  id: number,
  trackIds: readonly number[],
  now: number,
): PlaylistAddResult =>
  db.transaction((tx) => {
    const { playlists } = schema;
    const playlist = tx
      .select({ name: playlists.name })
      .from(playlists)
      .where(eq(playlists.id, id))
      .get();
    if (playlist === undefined) throw new Error("The playlist no longer exists");
    const result = appendItems(tx, id, trackIds, now);
    if (result.added > 0)
      tx.update(playlists).set({ updatedAt: now }).where(eq(playlists.id, id)).run();
    return { playlistId: id, name: playlist.name, ...result };
  });

const movePlaylistItemSync = (
  db: Database,
  playlistId: number,
  itemId: number,
  toIndex: number,
  now: number,
): void =>
  db.transaction((tx) => {
    const { playlists, playlistItems } = schema;
    const rows = tx
      .select({ id: playlistItems.id, position: playlistItems.position })
      .from(playlistItems)
      .where(eq(playlistItems.playlistId, playlistId))
      .orderBy(asc(playlistItems.position), asc(playlistItems.id))
      .all();
    const from = rows.findIndex((row) => row.id === itemId);
    if (from === -1) return;
    moveItem(rows, from, toIndex).forEach((row, position) => {
      if (row.position !== position)
        tx.update(playlistItems).set({ position }).where(eq(playlistItems.id, row.id)).run();
    });
    tx.update(playlists).set({ updatedAt: now }).where(eq(playlists.id, playlistId)).run();
  });

const make = Effect.gen(function* () {
  const db: Database = yield* Effect.try({
    try: () => {
      const client = openDatabaseSync(DATABASE_NAME);
      client.execSync("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
      return drizzle(client, { schema });
    },
    catch: (cause) => new LibraryStoreError({ operation: "open the database", cause }),
  });
  yield* Effect.tryPromise({
    try: () => migrate(db, migrations),
    catch: (cause) => new LibraryStoreError({ operation: "migrate", cause }),
  });

  const attempt = <A>(operation: string, run: () => A): Effect.Effect<A, LibraryStoreError> =>
    Effect.try({ try: run, catch: (cause) => new LibraryStoreError({ operation, cause }) });

  return LibraryStore.of({
    ensureDefaultRoot: (path) =>
      attempt("set up scan roots", () => {
        const existing = db.select().from(schema.scanRoots).all();
        if (existing.length > 0) return existing;
        db.insert(schema.scanRoots).values({ path, addedAt: Date.now(), isDefault: true }).run();
        return db.select().from(schema.scanRoots).all();
      }),

    listRoots: attempt("list music folders", () => {
      const { scanRoots, tracks } = schema;
      return db
        .select({
          path: scanRoots.path,
          isDefault: scanRoots.isDefault,
          lastScannedAt: scanRoots.lastScannedAt,
          trackCount: sql<number>`(SELECT count(*) FROM ${tracks}
            WHERE substr(${tracks.path}, 1, length(${scanRoots.path}) + 1) = ${scanRoots.path} || '/')`,
        })
        .from(scanRoots)
        .orderBy(asc(scanRoots.addedAt), asc(scanRoots.path))
        .all();
    }),

    addRoot: (path, drop) =>
      attempt("add a music folder", () =>
        db.transaction((tx) => {
          const { scanRoots } = schema;
          if (drop.length > 0)
            tx.delete(scanRoots)
              .where(inArray(scanRoots.path, [...drop]))
              .run();
          tx.insert(scanRoots).values({ path, addedAt: Date.now() }).onConflictDoNothing().run();
          tx.update(scanRoots).set({ isDefault: false }).run();
        }),
      ),

    removeRoot: (path) => attempt("remove a music folder", () => removeRootSync(db, path)),

    excludedFolders: attempt("read excluded folders", () =>
      db
        .select({ path: schema.excludedFolders.path })
        .from(schema.excludedFolders)
        .all()
        .map((row) => row.path),
    ),

    saveBatch: (tracks, artworkRows, moves = []) =>
      attempt("save scanned tracks", () =>
        saveBatchSync(db, tracks, artworkRows, moves, Date.now()),
      ),

    markScanned: (roots, at) =>
      attempt("record the scan", () => {
        if (roots.length === 0) return;
        db.update(schema.scanRoots)
          .set({ lastScannedAt: at })
          .where(inArray(schema.scanRoots.path, [...roots]))
          .run();
      }),

    countTracks: attempt(
      "count tracks",
      () =>
        db
          .select({ count: sql<number>`count(*)` })
          .from(schema.tracks)
          .get()?.count ?? 0,
    ),

    countLibrary: attempt("count the library", () => libraryCounts(db)),
    countSectionSongs: attempt("count the library's songs", () => sectionSongCounts(db)),

    listSongs: attempt("list songs", () =>
      trackQuery(db)
        .orderBy(...BY_TITLE)
        .all(),
    ),

    listLibraryLookupSongs: attempt("list songs to look up", () => selectLibraryLookupSongs(db)),

    trackDetails: (id) =>
      attempt(
        "read the playing track",
        () =>
          db
            .select({
              id: schema.tracks.id,
              artistId: schema.tracks.artistId,
              artist: schema.artists.name,
              albumId: schema.tracks.albumId,
              album: schema.albums.title,
              palette: schema.artwork.palette,
              path: schema.tracks.path,
            })
            .from(schema.tracks)
            .innerJoin(schema.artists, eq(schema.tracks.artistId, schema.artists.id))
            .innerJoin(schema.albums, eq(schema.tracks.albumId, schema.albums.id))
            .leftJoin(schema.artwork, eq(schema.tracks.artworkHash, schema.artwork.hash))
            .where(eq(schema.tracks.id, id))
            .get() ?? null,
      ),

    listAlbums: attempt("list albums", () => selectAlbums(db, undefined)),

    listAlbumsPage: (page) => attempt("list albums", () => selectAlbums(db, undefined, page)),

    listArtists: attempt("list artists", () => listArtistsSync(db)),

    listArtistsPage: (page) => attempt("list artists", () => selectArtists(db, { page })),

    listArtistSongsPage: (id, page) =>
      attempt("list the artist's songs", () => selectArtistSongs(db, id, page)),

    listPlaylistSongsPage: (id, page) =>
      attempt("list the playlist's songs", () => selectPlaylistSongs(db, id, page)),

    artistCovers: (ids) => attempt("load artist covers", () => selectArtistCovers(db, ids)),

    listGenres: attempt("list genres", () => {
      const { genres, tracks } = schema;
      return db
        .select({
          id: genres.id,
          name: genres.name,
          sort: genres.sort,
          trackCount: sql<number>`count(${tracks.id})`,
        })
        .from(genres)
        .innerJoin(tracks, eq(tracks.genreId, genres.id))
        .groupBy(genres.id)
        .orderBy(asc(genres.sort), asc(genres.id))
        .all();
    }),

    listFolders: attempt("list folders", () => listFoldersSync(db)),

    getAlbum: (id) => attempt("open the album", () => getAlbumSync(db, id)),

    getArtist: (id) => attempt("open the artist", () => getArtistSync(db, id)),

    getGenre: (id) => attempt("open the genre", () => getGenreSync(db, id)),

    getFolder: (id) => attempt("open the folder", () => getFolderSync(db, id)),

    knownFiles: (roots) =>
      attempt("read the library index", () => selectKnownFiles(db, roots)),

    indexedFiles: (paths) =>
      attempt("read missing files", () =>
        chunks(paths).flatMap((chunk) =>
          db
            .select({
              path: schema.tracks.path,
              sizeBytes: schema.tracks.sizeBytes,
              durationMs: schema.tracks.durationMs,
              title: schema.tracks.title,
              artist: schema.artists.name,
            })
            .from(schema.tracks)
            .innerJoin(schema.artists, eq(schema.tracks.artistId, schema.artists.id))
            .where(inArray(schema.tracks.path, chunk))
            .all(),
        ),
      ),

    removeTracks: (paths) => attempt("remove missing songs", () => removeTracksSync(db, paths)),

    addExcludedFolder: (path, drop) =>
      attempt("exclude a folder", () =>
        db.transaction((tx) => {
          const { excludedFolders } = schema;
          if (drop.length > 0)
            tx.delete(excludedFolders)
              .where(inArray(excludedFolders.path, [...drop]))
              .run();
          tx.insert(excludedFolders)
            .values({ path, addedAt: Date.now() })
            .onConflictDoNothing()
            .run();
        }),
      ),

    removeExcludedFolder: (path) =>
      attempt("include a folder again", () => {
        db.delete(schema.excludedFolders).where(eq(schema.excludedFolders.path, path)).run();
      }),

    songsByIds: (ids) =>
      attempt("read queued songs", () =>
        chunks(ids).flatMap((chunk) =>
          trackQuery(db).where(inArray(schema.tracks.id, chunk)).all(),
        ),
      ),

    loadPlayback: attempt(
      "read the saved queue",
      () =>
        db
          .select({
            queue: schema.savedPlayback.queue,
            positionMs: schema.savedPlayback.positionMs,
          })
          .from(schema.savedPlayback)
          .where(eq(schema.savedPlayback.id, SAVED_PLAYBACK_ID))
          .get() ?? null,
    ),

    saveQueue: (queue, positionMs) =>
      attempt("save the queue", () => {
        const row = { queue, positionMs: Math.round(positionMs), updatedAt: Date.now() };
        db.insert(schema.savedPlayback)
          .values({ id: SAVED_PLAYBACK_ID, ...row })
          .onConflictDoUpdate({ target: schema.savedPlayback.id, set: row })
          .run();
      }),

    savePosition: (positionMs) =>
      attempt("save the playback position", () => {
        db.update(schema.savedPlayback)
          .set({ positionMs: Math.round(positionMs), updatedAt: Date.now() })
          .where(eq(schema.savedPlayback.id, SAVED_PLAYBACK_ID))
          .run();
      }),

    listRecentSearches: attempt("read recent searches", () => listRecentSearchesSync(db)),

    rememberSearch: (query) =>
      attempt("save the search", () => rememberSearchSync(db, query, Date.now())),

    clearRecentSearches: attempt("clear recent searches", () => {
      db.delete(schema.recentSearches).run();
    }),

    listPlaylists: attempt("list playlists", () => listPlaylistsSync(db)),

    getPlaylist: (id) => attempt("open the playlist", () => getPlaylistSync(db, id)),

    createPlaylist: (name, trackIds) =>
      attempt("create the playlist", () => createPlaylistSync(db, name, trackIds, Date.now())),

    renamePlaylist: (id, name) =>
      attempt("rename the playlist", () =>
        db.transaction((tx) => {
          const { playlists } = schema;
          const others = tx
            .select({ name: playlists.name })
            .from(playlists)
            .where(ne(playlists.id, id))
            .all()
            .map((row) => row.name);
          tx.update(playlists)
            .set({ name: requireName(name, others), updatedAt: Date.now() })
            .where(eq(playlists.id, id))
            .run();
        }),
      ),

    deletePlaylist: (id) =>
      attempt("delete the playlist", () => {
        // Its items go with it (ON DELETE CASCADE).
        db.delete(schema.playlists).where(eq(schema.playlists.id, id)).run();
      }),

    addToPlaylist: (id, trackIds) =>
      attempt("add to the playlist", () => addToPlaylistSync(db, id, trackIds, Date.now())),

    movePlaylistItem: (playlistId, itemId, toIndex) =>
      attempt("reorder the playlist", () =>
        movePlaylistItemSync(db, playlistId, itemId, toIndex, Date.now()),
      ),

    removePlaylistItems: (playlistId, itemIds) =>
      attempt("remove from the playlist", () =>
        removePlaylistItems(db, playlistId, itemIds, Date.now()),
      ),

    replacePlaylistSongs: (playlistId, trackIds) =>
      attempt("replace the playlist's songs", () =>
        replacePlaylistSongs(db, playlistId, trackIds, Date.now()),
      ),

    trackPaths: attempt("read the library's files", () => selectTrackPaths(db)),

    favoriteTrackIds: attempt("read favorites", () =>
      db
        .select({ trackId: schema.favorites.trackId })
        .from(schema.favorites)
        .all()
        .map((row) => row.trackId),
    ),

    setFavorites: (trackIds, on) =>
      attempt(on ? "add favorites" : "remove favorites", () =>
        setFavorites(db, trackIds, on, Date.now()),
      ),

    listFavorites: attempt("list favorites", () => listFavorites(db)),

    recordPlay: (play) => attempt("record the play", () => recordPlay(db, play)),

    updatePlay: (id, play) => attempt("update the play", () => updatePlay(db, id, play)),

    home: attempt("read Home", () => homeSections(db)),

    latestPlay: attempt("read the latest play", () => latestPlay(db)),

    trackPlayTotals: (window) => attempt("sum up song plays", () => trackPlayTotals(db, window)),

    creditedPlayTotals: (window) =>
      attempt("sum up album and artist plays", () => creditedPlayTotals(db, window)),

    albumsByIds: (ids) =>
      attempt("read ranked albums", () =>
        ids.length === 0 ? [] : selectAlbums(db, inArray(schema.albums.id, [...ids])),
      ),

    artistsByIds: (ids) =>
      attempt("read ranked artists", () => (ids.length === 0 ? [] : listArtistsSync(db, ids))),

    linkRows: (ids) => attempt("read linked rows", () => selectLinkRows(db, ids)),

    songListening: attempt("sum up listening", () => songListening(db)),

    artistPhotoLookups: attempt("list artist photo lookups", () =>
      selectArtistPhotoLookups(db, Date.now()),
    ),

    recordArtistPhoto: (artistKey, record) =>
      attempt("record an artist photo", () => recordArtistPhoto(db, artistKey, record)),

    listArtistPhotos: attempt("list artist photos", () => selectArtistPhotos(db)),

    clearArtistPhotos: attempt("clear artist photos", () => clearArtistPhotos(db)),
  });
});

export const layer = Layer.effect(LibraryStore, make);
