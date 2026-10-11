import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

/**
 * Library schema. The store is the single owner of these tables; every change
 * goes with a new migration in `migrations.ts` (drizzle-kit doesn't run in agent
 * sessions, so migrations are written by hand and must match this file).
 *
 * `*_sort` columns hold Core sort keys and are compared with BINARY collation.
 * `key` columns hold Core identity keys.
 */

export const artists = sqliteTable(
  "artists",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    key: text("key").notNull().unique(),
    name: text("name").notNull(),
    sort: text("sort").notNull(),
  },
  (t) => [index("artists_sort_idx").on(t.sort)],
);

export const genres = sqliteTable(
  "genres",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    key: text("key").notNull().unique(),
    name: text("name").notNull(),
    sort: text("sort").notNull(),
  },
  (t) => [index("genres_sort_idx").on(t.sort)],
);

export const folders = sqliteTable("folders", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  path: text("path").notNull().unique(),
  name: text("name").notNull(),
});

/** Palette colours as `#rrggbb`; any may be missing. */
export interface ArtworkPalette {
  readonly dominant?: string;
  readonly vibrant?: string;
  readonly darkVibrant?: string;
  readonly lightVibrant?: string;
  readonly muted?: string;
  readonly darkMuted?: string;
  readonly lightMuted?: string;
}

/** Embedded artwork, stored once per unique image (identified by a hash of its bytes). */
export const artwork = sqliteTable("artwork", {
  hash: text("hash").primaryKey(),
  path: text("path").notNull(),
  thumbPath: text("thumb_path").notNull(),
  palette: text("palette", { mode: "json" }).$type<ArtworkPalette>().notNull(),
});

export const albums = sqliteTable(
  "albums",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    /** Core album key: title + album artist. */
    key: text("key").notNull().unique(),
    title: text("title").notNull(),
    titleSort: text("title_sort").notNull(),
    albumArtistId: integer("album_artist_id")
      .notNull()
      .references(() => artists.id),
    year: integer("year"),
    artworkHash: text("artwork_hash").references(() => artwork.hash),
    compilation: integer("compilation", { mode: "boolean" }).notNull().default(false),
  },
  (t) => [
    index("albums_title_sort_idx").on(t.titleSort),
    index("albums_album_artist_idx").on(t.albumArtistId),
  ],
);

export const tracks = sqliteTable(
  "tracks",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    /** Track identity in v1 (see the spec); moved files are matched by Core's reconciliation. */
    path: text("path").notNull().unique(),
    folderId: integer("folder_id")
      .notNull()
      .references(() => folders.id),
    fileName: text("file_name").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    modifiedAt: integer("modified_at").notNull(),
    title: text("title").notNull(),
    titleSort: text("title_sort").notNull(),
    artistId: integer("artist_id")
      .notNull()
      .references(() => artists.id),
    albumId: integer("album_id")
      .notNull()
      .references(() => albums.id),
    genreId: integer("genre_id").references(() => genres.id),
    year: integer("year"),
    trackNumber: integer("track_number"),
    trackTotal: integer("track_total"),
    discNumber: integer("disc_number"),
    discTotal: integer("disc_total"),
    durationMs: integer("duration_ms").notNull(),
    sampleRate: integer("sample_rate"),
    bitrateKbps: integer("bitrate_kbps"),
    artworkHash: text("artwork_hash").references(() => artwork.hash),
    /** When the file first entered the library (drives Recently Added). */
    addedAt: integer("added_at").notNull(),
    /** When a scan last saw the file. */
    scannedAt: integer("scanned_at").notNull(),
  },
  (t) => [
    index("tracks_title_sort_idx").on(t.titleSort),
    index("tracks_artist_idx").on(t.artistId),
    index("tracks_album_idx").on(t.albumId),
    index("tracks_genre_idx").on(t.genreId),
    index("tracks_folder_idx").on(t.folderId),
  ],
);

/** Folders Wave indexes. */
export const scanRoots = sqliteTable("scan_roots", {
  path: text("path").primaryKey(),
  addedAt: integer("added_at").notNull(),
  /** Added by Wave on first launch (the shared Music folder) rather than picked by the owner. */
  isDefault: integer("is_default", { mode: "boolean" }).notNull().default(false),
  /** When a full scan of this root last finished; null until the first one does. */
  lastScannedAt: integer("last_scanned_at"),
});

/** Folders under a scan root that Wave ignores. */
export const excludedFolders = sqliteTable("excluded_folders", {
  path: text("path").primaryKey(),
  addedAt: integer("added_at").notNull(),
});

/** The queue and position restored (paused) on launch. A single row, id 1. */
export const savedPlayback = sqliteTable("playback_state", {
  id: integer("id").primaryKey(),
  /** Core's `QueueState` as JSON; entries hold track ids. */
  queue: text("queue").notNull(),
  /** Where the current entry was, last time it was saved. */
  positionMs: integer("position_ms").notNull().default(0),
  updatedAt: integer("updated_at").notNull(),
});

/** The owner's recent searches, as Core's `rememberSearch` keeps them; the newest has the latest time. */
export const recentSearches = sqliteTable("recent_searches", {
  query: text("query").primaryKey(),
  searchedAt: integer("searched_at").notNull(),
});
