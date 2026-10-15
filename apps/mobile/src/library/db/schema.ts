import { sql, type SQL } from "drizzle-orm";
import {
  type AnySQLiteColumn,
  check,
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
    /**
     * The file: the track's identity on this phone (see the spec); moved files
     * are matched by Core's reconciliation. Null for a missing song (one the
     * Wave account has and this phone has no file for), which can't be played
     * from a file.
     */
    path: text("path").unique(),
    /**
     * What makes it the same song on another phone (Core's `recordingKey`),
     * computed whenever the file is saved. Null only from the update that
     * brought it in until the store keys the Library (`keyRecordings`).
     */
    recordingKey: text("recording_key"),
    /** The YouTube video id of a song downloaded from YouTube Music; null for any other. */
    videoId: text("video_id"),
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
    index("tracks_recording_key_idx").on(t.recordingKey),
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
  /**
   * Their page as JSON (Core's `YtArtistPage`: top songs, every song of theirs, albums,
   * singles); set when `found`.
   */
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

/**
 * This install. A single row, id 1: its phone id, random, made by the
 * migration that brought Wave accounts in (or the first launch's), never changed.
 */
export const phone = sqliteTable("phone", {
  id: integer("id").primaryKey(),
  phoneId: text("phone_id").notNull(),
});

/** This install's phone id (`phone`), as SQL: rows changed here are stamped with it. */
export const thisPhoneId = (): SQL<string> => sql<string>`(SELECT phone_id FROM phone)`;

/** A new id for a synced row, the same on every phone it goes to: 32 random hex digits, from SQLite. */
const newSyncId = (): SQL<string> => sql<string>`lower(hex(randomblob(16)))`;

/**
 * What every synced row of the Wave account records (Core's `SyncRow`): when
 * it last changed, by the clock of the phone that changed it, and which phone
 * that was (this one unless it came from the account). Removing the row
 * leaves it as a tombstone (`deleted`), which the Library never shows.
 */
const changeStamp = () => ({
  changedAt: integer("changed_at").notNull(),
  phoneId: text("phone_id").notNull().$defaultFn(thisPhoneId),
  deleted: integer("deleted", { mode: "boolean" }).notNull().default(false),
  ...pushedFlag(),
});

/**
 * Whether the row's last change is on the Wave account: false from a change
 * made on this phone until a push takes it (`db/sync.ts`); true for a change
 * that came from the account.
 */
const pushedFlag = () => ({
  pushed: integer("pushed", { mode: "boolean" }).notNull().default(false),
});

/** Playlists the owner made; a deleted one is a tombstone (`deleted`). */
export const playlists = sqliteTable(
  "playlists",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    /** The playlist's id on every phone, made on the phone that created it. */
    syncId: text("sync_id").notNull().unique().$defaultFn(newSyncId),
    name: text("name").notNull(),
    createdAt: integer("created_at").notNull(),
    /** When the name or the items last changed. */
    updatedAt: integer("updated_at").notNull(),
    /** When the name changed or the playlist was created or deleted (its entries have their own). */
    ...changeStamp(),
  },
  (t) => [
    index("playlists_changed_at_idx").on(t.changedAt),
    index("playlists_pushed_idx").on(t.pushed),
  ],
);

/**
 * A playlist's entries, ordered by `order_key` (Core's `orderKeyBetween`),
 * then `sync_id` for the entries two phones gave one key (Core's
 * `compareOrderKeys`): each a Library track (`track_id`) or a YT Music song
 * the Library doesn't have (`yt_song`, Core's `writePlaylistYtSong`), never
 * both. A removed entry is a tombstone (`deleted`). Entries go with their
 * playlist, and a track's with it when the track leaves the library.
 */
export const playlistItems = sqliteTable(
  "playlist_items",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    /** The entry's id on every phone, made on the phone that added it. */
    syncId: text("sync_id").notNull().unique().$defaultFn(newSyncId),
    playlistId: integer("playlist_id")
      .notNull()
      .references(() => playlists.id, { onDelete: "cascade" }),
    trackId: integer("track_id").references(() => tracks.id, { onDelete: "cascade" }),
    ytSong: text("yt_song"),
    orderKey: text("order_key").notNull(),
    addedAt: integer("added_at").notNull(),
    ...changeStamp(),
  },
  (t) => [
    index("playlist_items_playlist_order_idx").on(t.playlistId, t.orderKey, t.syncId),
    index("playlist_items_track_idx").on(t.trackId),
    index("playlist_items_changed_at_idx").on(t.changedAt),
    index("playlist_items_pushed_idx").on(t.pushed),
    check("playlist_items_one_song", sql`(${t.trackId} IS NULL) <> (${t.ytSong} IS NULL)`),
  ],
);

/**
 * Starred tracks; an unstarred one is a tombstone (`deleted`). A star goes
 * with its track when the track leaves the library.
 */
export const favorites = sqliteTable(
  "favorites",
  {
    trackId: integer("track_id")
      .primaryKey()
      .references(() => tracks.id, { onDelete: "cascade" }),
    /** When the track was starred (the Favorites list is newest first). */
    addedAt: integer("added_at").notNull(),
    ...changeStamp(),
  },
  (t) => [
    index("favorites_changed_at_idx").on(t.changedAt),
    index("favorites_pushed_idx").on(t.pushed),
  ],
);

/**
 * When each synced preference (a setting the Wave account keeps, by its
 * key-value store key) last changed and on which phone. The values stay in
 * the key-value store.
 */
export const preferenceChanges = sqliteTable("preference_changes", {
  key: text("key").primaryKey(),
  changedAt: integer("changed_at").notNull(),
  phoneId: text("phone_id").notNull().$defaultFn(thisPhoneId),
  ...pushedFlag(),
});

/**
 * The Wave account's songs as this phone knows them (Core's `SyncSong`, by
 * recording key), the songs it has no Track for included: what was last
 * pulled or pushed, and what this phone's own song with the key was then
 * (`local`, Core's `planSongSync`). A song changed here waits with `pushed`
 * false. Emptied when a sign-in joins an account.
 */
export const accountSongs = sqliteTable(
  "account_songs",
  {
    recordingKey: text("recording_key").primaryKey(),
    /** Core's `SyncSongFields` as JSON; null for a removed song (a tombstone). */
    song: text("song"),
    changedAt: integer("changed_at").notNull(),
    phoneId: text("phone_id").notNull(),
    deleted: integer("deleted", { mode: "boolean" }).notNull().default(false),
    ...pushedFlag(),
    /** Opaque (Core's `planSongSync`); null while this phone has no file with the key. */
    local: text("local"),
  },
  (t) => [index("account_songs_pushed_idx").on(t.pushed)],
);

/**
 * Rows the Wave account sent that this phone can't place yet: a star, an
 * entry or a play of a song it has no Track for (`song_key`), or an entry of
 * a playlist that hasn't come yet (`playlist_key`). Each is applied once
 * what it waits for is in the Library, and a newer change of the same row
 * replaces it. Emptied when a sign-in joins an account.
 */
export const syncPending = sqliteTable(
  "sync_pending",
  {
    /** The wire table: `playlistEntries`, `favorites` or `plays`. */
    kind: text("kind").notNull(),
    id: text("id").notNull(),
    songKey: text("song_key"),
    playlistKey: text("playlist_key"),
    /** The row as the account sent it (JSON). */
    row: text("row").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.kind, t.id] }),
    index("sync_pending_song_idx").on(t.songKey),
    index("sync_pending_playlist_idx").on(t.playlistKey),
  ],
);

/** Where syncing with the Wave account stands. A single row, id 1. */
export const syncState = sqliteTable("sync_state", {
  id: integer("id").primaryKey(),
  /** The account this phone's Library is joined with (its email); null while not joined. */
  account: text("account"),
  /** The service's cursor after the last page pulled; null to pull everything. */
  cursor: text("cursor"),
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
    /**
     * The song's recording key (Core's `recordingKey`), written when the play
     * is recorded, so the play keeps its song once the file is gone. Null for
     * plays of songs deleted before Wave kept it: those stay on this phone.
     */
    recordingKey: text("recording_key"),
    /**
     * The play's id on every phone: random for Wave's own plays, the same on
     * every phone for an imported one (Core's `blackPlayerPlayId`), the
     * account's for a pulled one. Null for an imported play until the store
     * keys it (`keyRecordings`), and for plays of songs deleted before Wave
     * kept recording keys.
     */
    syncId: text("sync_id").unique().$defaultFn(newSyncId),
    /**
     * The play going on now (at most one): it still changes, so it goes to
     * the Wave account only once it ends, or once a newer play starts.
     */
    ongoing: integer("ongoing", { mode: "boolean" }).notNull().default(false),
    ...pushedFlag(),
  },
  (t) => [
    index("play_events_track_idx").on(t.trackId),
    index("play_events_started_at_idx").on(t.startedAt),
    index("play_events_pushed_idx").on(t.pushed),
  ],
);
