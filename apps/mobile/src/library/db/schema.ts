import {
  type AnySQLiteColumn,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";

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
    /**
     * The artist's image, an album cover picked by Core's `artistArtwork`;
     * null for none (the initial placeholder). Re-picked after every scan.
     */
    artworkHash: text("artwork_hash").references((): AnySQLiteColumn => artwork.hash),
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
    /** The primary album artist: the first one [albumArtistCredit] names (see `albumArtists`). */
    albumArtistId: integer("album_artist_id")
      .notNull()
      .references(() => artists.id),
    /** The album artist credit as written ("Ariana Grande, Social House"), which rows show. */
    albumArtistCredit: text("album_artist_credit").notNull().default(""),
    /**
     * The album artist credits a multi-value tag gave, as a JSON array; null for
     * a single one, [albumArtistCredit] (see `storedCredits`).
     */
    albumArtistCredits: text("album_artist_credits"),
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
    /** The primary artist: the first one [artistCredit] names (see `trackArtists`). */
    artistId: integer("artist_id")
      .notNull()
      .references(() => artists.id),
    /** The artist credit as written ("Ariana Grande, Doja Cat"), which rows show. */
    artistCredit: text("artist_credit").notNull().default(""),
    /**
     * The artist credits a multi-value tag gave ("Ariana Grande", "Social
     * House"), as a JSON array; null for a single one, [artistCredit] (see
     * `storedCredits`). Each names its own artists.
     */
    artistCredits: text("artist_credits"),
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
    /**
     * Whether the song has lyrics, in its tags or a sidecar `.lrc`: the
     * whole-Library lyrics and genre run skips songs that have them and a genre.
     */
    hasLyrics: integer("has_lyrics", { mode: "boolean" }).notNull().default(false),
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

/**
 * Every artist a track's credit names (Core's `creditSplitter`), in credit
 * order: position 0 is the primary artist (`tracks.artist_id`).
 */
export const trackArtists = sqliteTable(
  "track_artists",
  {
    trackId: integer("track_id")
      .notNull()
      .references(() => tracks.id, { onDelete: "cascade" }),
    artistId: integer("artist_id")
      .notNull()
      .references(() => artists.id),
    position: integer("position").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.trackId, t.position] }),
    index("track_artists_artist_idx").on(t.artistId),
  ],
);

/**
 * Every artist a played track's credit named, in credit order, written from
 * its `track_artists` when the track leaves the library (`deleteTracks`), so
 * its plays keep counting for each of them in Stats. `track_id` has no
 * foreign key, as in `play_events`; a link goes with its artist when the
 * artist leaves the library.
 */
export const deletedTrackArtists = sqliteTable(
  "deleted_track_artists",
  {
    trackId: integer("track_id").notNull(),
    artistId: integer("artist_id")
      .notNull()
      .references(() => artists.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.trackId, t.position] }),
    index("deleted_track_artists_artist_idx").on(t.artistId),
  ],
);

/**
 * Every artist an album's album artist credit names, in credit order: the
 * album is filed under position 0 (`albums.album_artist_id`) and appears on
 * the others' pages.
 */
export const albumArtists = sqliteTable(
  "album_artists",
  {
    albumId: integer("album_id")
      .notNull()
      .references(() => albums.id, { onDelete: "cascade" }),
    artistId: integer("artist_id")
      .notNull()
      .references(() => artists.id),
    position: integer("position").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.albumId, t.position] }),
    index("album_artists_artist_idx").on(t.artistId),
  ],
);

/**
 * Artist photos downloaded from an online service, and lookups that found
 * none: one row per artist key (`artists.key`), kept when the artist leaves
 * the library so the photo isn't fetched again if they come back.
 */
export const artistPhotos = sqliteTable("artist_photos", {
  artistKey: text("artist_key").primaryKey(),
  /** Core's `ArtistPhotoOutcome`. */
  outcome: text("outcome", { enum: ["found", "unmatched", "failed"] }).notNull(),
  /** When the lookup was made (Core's `artistPhotoLookups` decides when to retry a miss). */
  checkedAt: integer("checked_at").notNull(),
  /** The large photo (artist page); set when `found`. */
  path: text("path"),
  /** The thumbnail (lists, menus); set when `found`. */
  thumbPath: text("thumb_path"),
});

/**
 * The artist page's YT Music section (docs/spec.md, "YT Music"): the last
 * answer YouTube Music gave for each artist, by artist key (a Library
 * artist's `identityKey`, or `yt:<browse id>` for a YouTube Music artist
 * page). Core's `ytArtistSectionView` and `ytArtistPageView` decide how long
 * it's shown without asking again.
 */
export const ytArtists = sqliteTable("yt_artists", {
  artistKey: text("artist_key").primaryKey(),
  /** Core's `YtArtistSaved` outcome. */
  outcome: text("outcome", { enum: ["found", "unmatched"] }).notNull(),
  /** When YouTube Music answered (ms since the epoch). */
  checkedAt: integer("checked_at").notNull(),
  /** The matched artist's YouTube Music browse id (`UC…`); set when `found`. */
  browseId: text("browse_id"),
  /** Their page as JSON (Core's `YtArtistPage`: top songs, albums, singles); set when `found`. */
  page: text("page"),
});

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

/** Playlists the owner made. */
export const playlists = sqliteTable("playlists", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  createdAt: integer("created_at").notNull(),
  /** When the name or the items last changed. */
  updatedAt: integer("updated_at").notNull(),
});

/**
 * A playlist's songs, ordered by `position` (gaps allowed). Items go with their
 * playlist, and with their track when its file leaves the library.
 */
export const playlistItems = sqliteTable(
  "playlist_items",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    playlistId: integer("playlist_id")
      .notNull()
      .references(() => playlists.id, { onDelete: "cascade" }),
    trackId: integer("track_id")
      .notNull()
      .references(() => tracks.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    addedAt: integer("added_at").notNull(),
  },
  (t) => [
    index("playlist_items_playlist_position_idx").on(t.playlistId, t.position),
    index("playlist_items_track_idx").on(t.trackId),
  ],
);

/** Starred tracks; a star goes with its track when the file leaves the library. */
export const favorites = sqliteTable("favorites", {
  trackId: integer("track_id")
    .primaryKey()
    .references(() => tracks.id, { onDelete: "cascade" }),
  /** When the track was starred (the Favorites list is newest first). */
  addedAt: integer("added_at").notNull(),
});

/**
 * One row per time a track started playing (Core's `PlayEvent`). Append-only:
 * a row is written when the play starts and updated until it ends, never
 * aggregated away. `track_id` has no foreign key on purpose, so history
 * outlives a deleted file (track ids are never reused: AUTOINCREMENT).
 */
export const playEvents = sqliteTable(
  "play_events",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    trackId: integer("track_id").notNull(),
    startedAt: integer("started_at").notNull(),
    listenedMs: integer("listened_ms").notNull(),
    /** Null when the player never learnt the track's length. */
    durationMs: integer("duration_ms"),
    endReason: text("end_reason", {
      enum: ["completed", "skipped", "stopped", "interrupted"],
    }).notNull(),
    /** Core's counted-play rule (`isCountedPlay`: more than 15 s listened, or a short song played through). */
    counted: integer("counted", { mode: "boolean" }).notNull(),
    /** The play context (album, playlist, search…); null for Play Next / Add to Queue. */
    contextType: text("context_type"),
    contextId: text("context_id"),
    /** Where the play was started from (Core's `PlaySource`); plays from before v2 are `phone`. */
    source: text("source", { enum: ["phone", "auto"] })
      .notNull()
      .default("phone"),
    /**
     * The track's album, written when the track leaves the library
     * (`deleteTracks`) so its plays keep counting for it in Stats (its artists
     * go to `deleted_track_artists`). Null while the track is in the library
     * (read the track instead), and for tracks that left before Wave kept it.
     */
    albumId: integer("album_id"),
    /**
     * Where an imported play came from (`blackplayer`: BlackPlayer's track
     * stats, `db/blackPlayer.ts`); null for Wave's own plays.
     */
    importedFrom: text("imported_from", { enum: ["blackplayer"] }),
  },
  (t) => [
    index("play_events_track_idx").on(t.trackId),
    index("play_events_started_at_idx").on(t.startedAt),
  ],
);
