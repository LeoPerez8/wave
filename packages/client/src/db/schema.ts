import { sql, type SQL } from "drizzle-orm";
import type { PlaySnapshot, PlaylistRecommendationTrack, YtAlbumSong } from "@wave/core";
import {
  type AnySQLiteColumn,
  check,
  index,
  integer,
  primaryKey,
  real,
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
    /** Core recording-title key; null only until the upgrade backfill. */
    matchTitle: text("match_title"),
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
    /** The genre the Library files the song under: its genre tag's first value. */
    genreId: integer("genre_id").references(() => genres.id),
    /**
     * Every value of a multi-value genre tag ("Metalcore", "Electronic"), as
     * a JSON array; null for one or none (see `storedGenres`). Only Genre
     * mixes read them.
     */
    genres: text("genres"),
    releaseDate: text("release_date"),
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
    /**
     * Whether the song is explicit, as its file's advisory tag says (Core's
     * `explicitFromAdvisory`): unknown when it has none.
     */
    explicit: text("explicit", { enum: ["explicit", "clean", "unknown"] })
      .notNull()
      .default("unknown"),
    /**
     * What the file's ReplayGain or R128 tags say, for Normalize Volume (Core's
     * `gainTags`): gains at -14 LUFS, peaks on a 0–1 full-scale range; null
     * where it says nothing. Read again with the rest of its tags; never
     * written to the file, never synced.
     */
    tagTrackGain: real("tag_track_gain"),
    tagTrackPeak: real("tag_track_peak"),
    tagAlbumGain: real("tag_album_gain"),
    tagAlbumPeak: real("tag_album_peak"),
    /**
     * The file's ISRC tag (Core's `isrcFromTag`), read again with the rest of
     * its tags: DJ's moods look the song up by it. Never written, never synced.
     */
    isrc: text("isrc"),
    /**
     * Normalize Volume: Wave's measurement of a file without tags, its
     * integrated loudness (ITU-R BS.1770, LUFS) and sample peak (0–1), with
     * the size and modified time of the file it was made of. The size and time
     * without a loudness: the file couldn't be measured. A save that sees the
     * file change clears all four (`saveBatch`); the scan's re-read sentinel
     * (`modified_at = 0`) leaves them. Local only, never synced.
     */
    measuredLoudness: real("measured_loudness"),
    measuredPeak: real("measured_peak"),
    measuredSizeBytes: integer("measured_size_bytes"),
    measuredModifiedAt: integer("measured_modified_at"),
    /** When the file first entered the library (drives Recently Added). */
    addedAt: integer("added_at").notNull(),
    /** When a scan last saw the file. */
    scannedAt: integer("scanned_at").notNull(),
  },
  (t) => [
    index("tracks_title_sort_idx").on(t.titleSort),
    index("tracks_match_title_idx").on(t.matchTitle),
    index("tracks_artist_idx").on(t.artistId),
    index("tracks_album_idx").on(t.albumId),
    index("tracks_genre_idx").on(t.genreId),
    index("tracks_folder_idx").on(t.folderId),
    index("tracks_recording_key_idx").on(t.recordingKey),
    index("tracks_video_idx").on(t.videoId),
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

/**
 * Voice notes and recordings a scan left out of the Library (Core's
 * `isVoiceNoteOrRecording`), with the size and date it found, so the next
 * scan passes over them unread. This phone only, never synced.
 */
export const skippedFiles = sqliteTable("skipped_files", {
  path: text("path").primaryKey(),
  sizeBytes: integer("size_bytes").notNull(),
  modifiedAt: integer("modified_at").notNull(),
});

/** The queue and position restored (paused) on launch. A single row, id 1. */
export const savedPlayback = sqliteTable("playback_state", {
  id: integer("id").primaryKey(),
  /** Core's `QueueState` as JSON; entries hold track ids. */
  queue: text("queue").notNull(),
  queueIndex: integer("queue_index"),
  /** Context, shuffle, repeat and key counter; separate from the entry JSON. */
  metadata: text("queue_metadata"),
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
    /**
     * The image the owner gave the playlist, square, shown in place of its
     * mosaic (`imageThumbPath` in lists, and `catalog/artworkUri.ts` picks the
     * file by the size shown). Files in Wave's own storage; they stay
     * on this phone, so setting one isn't a change (no stamp, never synced).
     */
    imagePath: text("image_path"),
    imageThumbPath: text("image_thumb_path"),
    /**
     * The photo the image was framed from, kept for Adjust Image, and the
     * framing (Core's `framingText`); null for an image saved before
     * originals were kept, which is its own original.
     */
    imageOriginalPath: text("image_original_path"),
    imageFraming: text("image_framing"),
    /** When the name changed or the playlist was created or deleted (its entries have their own). */
    ...changeStamp(),
  },
  (t) => [
    index("playlists_changed_at_idx").on(t.changedAt),
    index("playlists_pushed_idx").on(t.pushed),
  ],
);

/** Whether the entry [ytSong] holds is an unsearched song, as Core's `writePlaylistEntrySong` marks it. */
export const unsearchedSongIn = (ytSong: AnySQLiteColumn): SQL =>
  sql`(CASE WHEN json_valid(${ytSong})
  THEN json_type(${ytSong}, '$.unsearched') = 'true' END IS 1)`;

/**
 * The title of the unsearched song [ytSong] holds; null for any other entry.
 * `playlist_items_unsearched_title_idx` indexes it, so settling a song finds
 * the entries holding it without reading every playlist's.
 */
export const unsearchedTitleIn = (ytSong: AnySQLiteColumn): SQL =>
  sql`CASE WHEN ${unsearchedSongIn(ytSong)}
  THEN json_extract(${ytSong}, '$.title') END`;

/**
 * The video id of the YT Music song [ytSong] holds; null for one that isn't
 * JSON. `playlist_items_video_idx` indexes it for the entries that hold a
 * song, so queries must write it exactly so.
 */
export const videoIdIn = (ytSong: AnySQLiteColumn): SQL =>
  sql`CASE WHEN json_valid(${ytSong})
  THEN json_extract(${ytSong}, '$.videoId') END`;

/** Indexed title for unsearched and unavailable entries a download job can still hold. */
export const listedTitleIn = (ytSong: AnySQLiteColumn): SQL =>
  sql`CASE WHEN json_valid(${ytSong})
  THEN CASE WHEN json_extract(${ytSong}, '$.videoId') IS NULL
  THEN json_extract(${ytSong}, '$.title') END END`;

/**
 * A playlist's entries, ordered by `order_key` (Core's `orderKeyBetween`),
 * then `sync_id` for the entries two phones gave one key (Core's
 * `compareOrderKeys`): each a Library track (`track_id`) or a YT Music song
 * the Library doesn't have (`yt_song`, Core's `writePlaylistYtSong`), never
 * both. A removed entry is a tombstone (`deleted`). Entries go with their
 * playlist. A track leaving the Library doesn't take its entries: they become
 * the entry a song without a file is (Core's `leavingSongEntry`), or the store
 * deletes them where they leave with it (`deleteTracks`).
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
    trackId: integer("track_id").references(() => tracks.id),
    ytSong: text("yt_song"),
    removedAt: integer("removed_at"),
    /** When Restore or Undo last brought the entry back (Core's `SyncEntryRow`). */
    restoredAt: integer("restored_at"),
    /** The account that added the entry, as the service records it (an entry's `addedBy`). */
    addedBy: text("added_by"),
    /**
     * A collaborative playlist's Library entry as the account holds it (JSON: its recording
     * key `songId` and Core's `LibraryEntryFields`), kept so the entry goes up as it came
     * whether this device plays it from a Track, a stream or an unsearched song. Null for
     * every other entry.
     */
    libraryEntry: text("library_entry"),
    orderKey: text("order_key").notNull(),
    addedAt: integer("added_at").notNull(),
    ...changeStamp(),
  },
  (t) => [
    index("playlist_items_playlist_order_idx").on(t.playlistId, t.orderKey, t.syncId),
    index("playlist_items_track_idx").on(t.trackId),
    index("playlist_items_changed_at_idx").on(t.changedAt),
    index("playlist_items_pushed_idx").on(t.pushed),
    index("playlist_items_unsearched_title_idx").on(unsearchedTitleIn(t.ytSong)),
    index("playlist_items_listed_title_idx").on(listedTitleIn(t.ytSong), t.deleted, t.playlistId),
    index("playlist_items_video_idx")
      .on(videoIdIn(t.ytSong), t.deleted, t.playlistId)
      .where(sql`${t.ytSong} IS NOT NULL`),
    check("playlist_items_one_song", sql`(${t.trackId} IS NULL) <> (${t.ytSong} IS NULL)`),
  ],
);

/**
 * A counter per playlist that SQLite triggers (migration 0022) raise on every
 * write to its entries that can change its mosaic or totals: an entry added,
 * removed, moved, linked to a Library song, pulled from the Wave account, or
 * gone with its song. Row 0 is the Library's: raised when a track's length or
 * album, an album's cover or a cover's files change. Library › Playlists
 * works out again only the playlists whose counter (or the Library's) moved
 * since it last read them (`db/playlists.ts`). Row -1 is no counter: it
 * keeps the entries' revision the last whole-Library link left (a scan's,
 * `markPlaylistsLinked`). Never synced.
 */
export const playlistRevisions = sqliteTable("playlist_revisions", {
  /**
   * A playlist's id, 0 for the Library's tracks, albums and covers, or -1 for the entries'
   * revision the last whole-Library link saw (`playlists.ts`, `LINKED_REVISION`). No foreign key.
   */
  playlistId: integer("playlist_id").primaryKey(),
  revision: integer("revision").notNull().default(0),
});

/** Local recommendation adjustments. Never a source of global taste or graph learning. */
export const playlistRecommendationFeedback = sqliteTable(
  "playlist_recommendation_feedback",
  {
    playlistId: integer("playlist_id")
      .notNull()
      .references(() => playlists.id, { onDelete: "cascade" }),
    offerKey: text("offer_key").notNull(),
    track: text("track", { mode: "json" }).$type<PlaylistRecommendationTrack>().notNull(),
    value: integer("value").$type<-1 | 1>().notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.playlistId, t.offerKey] }),
    check("playlist_feedback_value", sql`${t.value} IN (-1, 1)`),
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

/**
 * Removals made here whose rows the Library no longer has, waiting to go up
 * as tombstones (Core's `songsLeaving`): the star and playlist entries of a
 * song removed from the Library (Remove from Library, Delete), and the star
 * of a retagged song's old recording key. Each leaves once a push takes it.
 * Emptied when a sign-in joins an account.
 */
export const syncRemovals = sqliteTable(
  "sync_removals",
  {
    /** The wire table: `favorites` or `playlistEntries`. */
    kind: text("kind").notNull(),
    /** The row's id on the account (a star's recording key, an entry's sync id). */
    id: text("id").notNull(),
    changedAt: integer("changed_at").notNull(),
    phoneId: text("phone_id").notNull(),
  },
  (t) => [primaryKey({ columns: [t.kind, t.id] })],
);

/**
 * The collaborative playlists of the account signed in (docs/spec.md, "Collaborative
 * playlists"), as its account pull last stated them: by the playlist's sync id, whether the
 * account owns it, its members, and for a member's playlist its own pull's cursor. A member's
 * playlist syncs through the collaboration routes and never with the account's own push.
 * Emptied when the device signs out.
 */
export const collaborations = sqliteTable("collaborations", {
  playlistSyncId: text("playlist_sync_id").primaryKey(),
  owned: integer("owned", { mode: "boolean" }).notNull(),
  ownerAccountId: text("owner_account_id"),
  /** The members (JSON, Core's `CollaborationMember`s), the owner first. */
  members: text("members").notNull(),
  /** The cursor of the playlist's own pull (a member's); null to pull it from the start. */
  cursor: text("cursor"),
  /** A pull brought a change this device didn't make, and the playlist wasn't opened since. */
  unseen: integer("unseen", { mode: "boolean" }).notNull().default(false),
  /** The invite link this device created (only its creator ever holds the address). */
  inviteUrl: text("invite_url"),
  inviteExpiresAt: integer("invite_expires_at"),
});

/**
 * Playlists that became the member's private copy when their membership ended, until the
 * page has said so once. This device only.
 */
export const privateCopyNotices = sqliteTable("private_copy_notices", {
  playlistId: integer("playlist_id")
    .primaryKey()
    .references(() => playlists.id, { onDelete: "cascade" }),
});

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
 * aggregated away. A play identifies a Library track, a video, or a synced
 * recording whose Library song hasn't arrived yet.
 * `track_id` has no foreign key on purpose, so history
 * outlives a deleted file (track ids are never reused: AUTOINCREMENT).
 */
export const playEvents = sqliteTable(
  "play_events",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    trackId: integer("track_id"),
    videoId: text("video_id"),
    /** Queue metadata captured at start, for streamed history playback and menus. */
    streamedSong: text("streamed_song", { mode: "json" }).$type<YtAlbumSong>(),
    startedAt: integer("started_at").notNull(),
    /** Display metadata captured at playback start; never changed by a progress update. */
    snapshot: text("snapshot", { mode: "json" }).$type<PlaySnapshot>(),
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
    source: text("source", { enum: ["phone", "auto", "desktop"] })
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
    check(
      "play_events_identity",
      sql`
      (${t.trackId} IS NOT NULL AND ${t.videoId} IS NULL) OR
      (${t.trackId} IS NULL AND (${t.videoId} IS NOT NULL OR
        (${t.recordingKey} IS NOT NULL AND ${t.snapshot} IS NOT NULL)))`,
    ),
    index("play_events_video_idx").on(t.videoId),
    index("play_events_track_idx").on(t.trackId),
    index("play_events_started_at_idx").on(t.startedAt),
    index("play_events_history_idx")
      .on(sql`${t.startedAt} DESC`, sql`${t.id} DESC`)
      .where(sql`${t.counted} = 1 AND ${t.importedFrom} IS NULL`),
    index("play_events_pushed_idx").on(t.pushed),
    // The ongoing play, which a play start ends (`recordPlay`).
    index("play_events_ongoing_idx")
      .on(t.ongoing)
      .where(sql`${t.ongoing} = 1`),
    // When each playlist was last played (the Playlists list's Recently Played).
    index("play_events_context_idx").on(t.contextType, t.contextId, t.startedAt, t.trackId),
  ],
);

/**
 * Each played track's listening over its whole history, kept by SQLite
 * triggers on `play_events` (migration `0023_play_totals`) as plays are
 * recorded, brought up to date, imported, pulled or edited, so Home reads
 * all-time totals without summing every play. One row per track with a play,
 * however it left the library (no foreign key, as in `play_events`).
 * `playTotalsDrift` compares it with the history; `rebuildPlayTotals` sums
 * it again.
 */
export const playTotals = sqliteTable(
  "play_totals",
  {
    trackId: integer("track_id").primaryKey(),
    /** Every play event, counted or not. */
    plays: integer("plays").notNull(),
    countedPlays: integer("counted_plays").notNull(),
    /** Time listened over every play, skipped and uncounted ones included. */
    listenedMs: integer("listened_ms").notNull(),
    /** Time listened over the counted plays (what Stats ranks by). */
    countedListenedMs: integer("counted_listened_ms").notNull(),
    /** When the latest play, counted or not, started. */
    lastPlayedAt: integer("last_played_at").notNull(),
    /** When the latest counted play started; null without one. */
    lastCountedAt: integer("last_counted_at"),
    /** The highest `play_events.album_id` of the counted plays: the album of a deleted track. */
    albumId: integer("album_id"),
  },
  (t) => [
    index("play_totals_counted_idx").on(t.countedPlays, t.lastCountedAt),
    index("play_totals_last_played_idx").on(t.lastPlayedAt),
  ],
);

/**
 * Each streamed song's listening over its whole history, as `play_totals`
 * keeps a track's: one row per video id and recording key with a streamed
 * play (a key that changed between plays gives the video a row per key), kept
 * by triggers on `play_events` (migration `0042_streamed_counts`). Home reads
 * them beside `play_totals`, the rows whose video id or key a Library song has
 * counting as that song's (`streamedTrack`).
 */
export const streamedTotals = sqliteTable(
  "streamed_totals",
  {
    videoId: text("video_id").notNull(),
    /** The plays' recording key; empty for plays without one. */
    recordingKey: text("recording_key").notNull(),
    plays: integer("plays").notNull(),
    countedPlays: integer("counted_plays").notNull(),
    listenedMs: integer("listened_ms").notNull(),
    countedListenedMs: integer("counted_listened_ms").notNull(),
    lastPlayedAt: integer("last_played_at").notNull(),
    lastCountedAt: integer("last_counted_at"),
  },
  (t) => [primaryKey({ columns: [t.videoId, t.recordingKey] })],
);

/**
 * The kept play totals (#1349, migration `0069_kept_play_totals`, which says
 * what each table holds and which triggers keep it). Read through raw SQL in
 * `keptPlayTotals.ts`; declared here so the schema matches the migrations.
 */
export const playedSongs = sqliteTable(
  "played_songs",
  {
    song: text("song").primaryKey(),
    trackId: integer("track_id"),
    videoId: text("video_id"),
    recordingKey: text("recording_key"),
    /** 0: its days and blocks owed; 1: its credits owed; 2: settled. */
    state: integer("state").notNull(),
    songTrack: integer("song_track"),
    online: integer("online").notNull().default(0),
    albumHint: text("album_hint"),
  },
  (t) => [
    index("played_songs_state_idx").on(t.state),
    index("played_songs_track_idx").on(t.trackId),
    index("played_songs_video_idx").on(t.videoId),
    index("played_songs_recording_idx").on(t.recordingKey),
    index("played_songs_song_track_idx").on(t.songTrack),
    index("played_songs_online_idx").on(t.online, t.state),
    index("played_songs_album_hint_idx").on(t.albumHint),
  ],
);

const keptSums = {
  span: integer("span").notNull(),
  bucket: integer("bucket").notNull(),
  countedPlays: integer("counted_plays").notNull(),
};

export const playBuckets = sqliteTable(
  "play_buckets",
  {
    song: text("song").notNull(),
    ...keptSums,
    listenedMs: integer("listened_ms").notNull(),
    latestPlayAt: integer("latest_play_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.song, t.span, t.bucket] })],
);

/** Days of a song's `play_buckets` a write to the history changed, to count again. */
export const owedDays = sqliteTable(
  "owed_days",
  {
    song: text("song").notNull(),
    day: integer("day").notNull(),
  },
  (t) => [primaryKey({ columns: [t.song, t.day] })],
);

export const playCredits = sqliteTable(
  "play_credits",
  {
    song: text("song").notNull(),
    kind: text("kind", { enum: ["album", "artist", "credit", "song"] }).notNull(),
    entity: text("entity").notNull(),
    weight: integer("weight").notNull(),
    albumId: integer("album_id"),
    artistId: integer("artist_id"),
  },
  (t) => [
    primaryKey({ columns: [t.song, t.kind, t.entity] }),
    index("play_credits_entity_idx").on(t.kind, t.entity),
    index("play_credits_album_idx").on(t.albumId),
    index("play_credits_artist_idx").on(t.artistId),
  ],
);

export const creditedBuckets = sqliteTable(
  "credited_buckets",
  {
    kind: text("kind").notNull(),
    entity: text("entity").notNull(),
    ...keptSums,
    listenedMs: integer("listened_ms").notNull(),
    latestPlayAt: integer("latest_play_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.kind, t.span, t.bucket, t.entity] })],
);

export const playedEntities = sqliteTable(
  "played_entities",
  {
    kind: text("kind").notNull(),
    entity: text("entity").notNull(),
    sortKey: text("sort_key").notNull(),
    item: text("item").notNull(),
    playedAt: integer("played_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.kind, t.entity] })],
);

export const playedRecordings = sqliteTable("played_recordings", {
  recordingKey: text("recording_key").primaryKey(),
  countedPlays: integer("counted_plays").notNull(),
});

export const playlistPlayBuckets = sqliteTable(
  "playlist_play_buckets",
  {
    contextId: text("context_id").notNull(),
    ...keptSums,
    latestPlayAt: integer("latest_play_at"),
  },
  (t) => [
    primaryKey({ columns: [t.contextId, t.span, t.bucket] }),
    index("playlist_play_buckets_bucket_idx").on(t.span, t.bucket),
  ],
);

export const keptTotalsState = sqliteTable("kept_totals_state", {
  id: integer("id").primaryKey(),
  /** Bumped when what Core matches streamed songs against changes. */
  generation: integer("generation").notNull(),
  seededThrough: integer("seeded_through").notNull(),
  seedUntil: integer("seed_until").notNull(),
});

/**
 * Pending favorites (Core's `PendingFavorite`): liked songs Also add to
 * Favorites couldn't star because the Library didn't have them, and YT Music
 * songs starred anywhere (a star means downloaded), each by its
 * YouTube Music video and its recording (title, artists, length). A download
 * or scan that brings one in stars it and deletes its row (`saveBatch`).
 * This phone only, never synced, and never listed in Favorites.
 */
export const pendingFavorites = sqliteTable("pending_favorites", {
  videoId: text("video_id").primaryKey(),
  title: text("title").notNull(),
  /** The song's artists, a JSON array of names. */
  artists: text("artists").notNull(),
  durationMs: integer("duration_ms"),
  addedAt: integer("added_at").notNull(),
});

/**
 * Disliked songs (Core's `DislikedSong`, `dislikes.ts`): each by the identity
 * favorites use, as its queue track id (a Library song's Track id as text, a
 * YT Music song's `yt:` video), with the song as it was listed when disliked,
 * so the list of them needs no other read. A dislike outlives its song's
 * file. They sync with the Wave account (`db/syncRows.ts`), a removed one
 * staying as a tombstone (`deleted`).
 */
export const dislikes = sqliteTable(
  "dislikes",
  {
    songKey: text("song_key").primaryKey(),
    title: text("title").notNull(),
    /** The song's artists, a JSON array of names. */
    artists: text("artists").notNull(),
    durationMs: integer("duration_ms"),
    /** When the song was disliked (the Disliked songs list is newest first). */
    dislikedAt: integer("disliked_at").notNull(),
    ...changeStamp(),
  },
  (t) => [
    index("dislikes_disliked_at_idx").on(t.dislikedAt),
    index("dislikes_pushed_idx").on(t.pushed),
  ],
);

/**
 * Lyrics the Lyrics view found online for non-D songs (Core's `SavedLyrics`),
 * by YouTube video: the lyrics, or a miss ([lyrics] null) remembered for a
 * week (`LYRICS_MISS_RETRY_MS`). Reopening one shows them at once, offline
 * too. This phone only, never synced.
 */
export const savedLyrics = sqliteTable("saved_lyrics", {
  videoId: text("video_id").primaryKey(),
  /** LRC when [synced], plain text otherwise; null for a miss. */
  lyrics: text("lyrics"),
  synced: integer("synced", { mode: "boolean" }).notNull().default(false),
  /** When the search was made (ms since the epoch). */
  checkedAt: integer("checked_at").notNull(),
});

/** Word positions for saved streamed-song lyrics, searchable offline by video. */
export const savedLyricsSearchIndex = sqliteTable("saved_lyrics_search_index", {
  videoId: text("video_id")
    .primaryKey()
    .references(() => savedLyrics.videoId, { onDelete: "cascade" }),
  lyrics: text("lyrics").notNull(),
});

export const savedLyricsSearchWords = sqliteTable(
  "saved_lyrics_search_words",
  {
    videoId: text("video_id")
      .notNull()
      .references(() => savedLyricsSearchIndex.videoId, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    word: text("word").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.videoId, t.position] }),
    index("saved_lyrics_search_word_idx").on(t.word, t.videoId, t.position),
  ],
);

/**
 * The songs a quality replacement found no better copy of (Core's
 * `noBetterCopies`): no Soulseek 320 for an upgrade, no YouTube Music match
 * for a downgrade, or a failure after retries. Each keeps its file and isn't
 * offered in that direction again. Goes with its Track; this phone only.
 */
export const noBetterCopies = sqliteTable(
  "no_better_copies",
  {
    trackId: integer("track_id")
      .notNull()
      .references(() => tracks.id, { onDelete: "cascade" }),
    /** Core's `QualityDirection`: "upgrade" or "downgrade". */
    direction: text("direction").notNull(),
  },
  (t) => [primaryKey({ columns: [t.trackId, t.direction] })],
);

/**
 * Library songs whose file has no lyrics and for which the Lyrics view's
 * online search found none (Core's `libraryLyrics`): not searched again for
 * a week (`LYRICS_MISS_RETRY_MS`). Lyrics it finds go into the file, so only
 * misses are kept. This phone only, never synced.
 */
export const lyricsMisses = sqliteTable("lyrics_misses", {
  trackId: integer("track_id")
    .primaryKey()
    .references(() => tracks.id, { onDelete: "cascade" }),
  /** When the search found nothing (ms since the epoch). */
  checkedAt: integer("checked_at").notNull(),
});

/** Timestamp-free local lyrics text used to narrow Search candidates. Never synced. */
export const lyricsSearchIndex = sqliteTable("lyrics_search_index", {
  trackId: integer("track_id")
    .primaryKey()
    .references(() => tracks.id, { onDelete: "cascade" }),
  lyrics: text("lyrics").notNull(),
});

/** Word positions are indexed for contiguous lyric phrase candidate lookup. */
export const lyricsSearchWords = sqliteTable(
  "lyrics_search_words",
  {
    trackId: integer("track_id")
      .notNull()
      .references(() => lyricsSearchIndex.trackId, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    word: text("word").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.trackId, t.position] }),
    index("lyrics_search_word_idx").on(t.word, t.trackId, t.position),
  ],
);

/**
 * YT Music songs the owner streamed (`writePlaylistYtSong`'s JSON, by video):
 * how many times and when first and last. Streamed plays aren't play history
 * (Stats stays about the Library); Home's mixes read this to keep songs the
 * owner knows out of their new songs and to stream them in their familiar
 * share (Core's `mixKnownSongs`). This phone only, never synced.
 */
export const streamedSongs = sqliteTable("streamed_songs", {
  videoId: text("video_id").primaryKey(),
  song: text("song").notNull(),
  plays: integer("plays").notNull(),
  firstPlayedAt: integer("first_played_at").notNull(),
  lastPlayedAt: integer("last_played_at").notNull(),
});

/**
 * The candidate catalog (docs/spec.md, "Candidate catalog"): the YT Music
 * songs radios and artist pages brought (`writePlaylistYtSong`'s JSON, by
 * video), with when first and last seen. Core decides what comes in and
 * what leaves (`catalogSeen`, `catalogLeaving`). A rebuildable cache, like
 * the saved mixes: this phone only, never synced.
 */
export const candidateSongs = sqliteTable(
  "candidate_songs",
  {
    videoId: text("video_id").primaryKey(),
    song: text("song").notNull(),
    firstSeenAt: integer("first_seen_at").notNull(),
    lastSeenAt: integer("last_seen_at").notNull(),
  },
  (t) => [index("candidate_songs_last_seen_idx").on(t.lastSeenAt)],
);

/**
 * The candidate catalog's radio evidence: each radio that brought a song,
 * by its seed artist (Core's `catalogSeedKey`), and when it last did. A
 * song's radio count is its rows; an artist's radio is the songs of its
 * seed key. This phone only, never synced.
 */
export const candidateRadios = sqliteTable(
  "candidate_radios",
  {
    videoId: text("video_id")
      .notNull()
      .references(() => candidateSongs.videoId, { onDelete: "cascade" }),
    seedKey: text("seed_key").notNull(),
    seedName: text("seed_name").notNull(),
    lastSeenAt: integer("last_seen_at").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.videoId, t.seedKey] }),
    index("candidate_radios_seed_idx").on(t.seedKey),
    index("candidate_radios_last_seen_idx").on(t.lastSeenAt),
  ],
);

/**
 * Files Wave must delete, recorded in the transaction that made them
 * leftovers: a quality replacement's old file once its Track took the new
 * one (`replaceTrackFile`), or a failed replacement's new file. Cleared once
 * the file is gone or missing; each launch and each replacement run finishes
 * what's still here (the app's `finishFileDeletions`), and scans leave these
 * files out. This phone only, never synced.
 */
export const fileDeletions = sqliteTable("file_deletions", {
  path: text("path").primaryKey(),
  /** When the deletion was recorded (ms since the epoch). */
  recordedAt: integer("recorded_at").notNull(),
});

/**
 * Each genre song's sort keys (#601), so a genre's pages are index seeks in
 * every sort: one row per Track with a genre, its nulls as Core's
 * `songOrderTerms` read them (no disc is disc 1, no track number sorts last).
 * Path (null as empty text) and id finish every index, including large runs
 * of identical names. Triggers in migration
 * 0038 keep it, whoever writes the tracks, artists or albums.
 */
export const genreOrder = sqliteTable(
  "genre_order",
  {
    /** The Track's id. */
    id: integer("id").primaryKey(),
    genreId: integer("genre_id").notNull(),
    titleSort: text("title_sort").notNull(),
    artistSort: text("artist_sort").notNull(),
    albumSort: text("album_sort").notNull(),
    albumId: integer("album_id").notNull(),
    discNumber: integer("disc_number").notNull(),
    trackNumber: integer("track_number").notNull(),
    addedAt: integer("added_at").notNull(),
    path: text("path").notNull(),
  },
  (t) => [
    index("genre_order_title_asc").on(t.genreId, t.titleSort, t.artistSort, t.path, t.id),
    index("genre_order_title_desc").on(
      t.genreId,
      sql`${t.titleSort} desc`,
      t.artistSort,
      t.path,
      t.id,
    ),
    index("genre_order_artist_asc").on(
      t.genreId,
      t.artistSort,
      t.albumSort,
      t.albumId,
      t.discNumber,
      t.trackNumber,
      t.titleSort,
      t.path,
      t.id,
    ),
    index("genre_order_artist_desc").on(
      t.genreId,
      sql`${t.artistSort} desc`,
      t.albumSort,
      t.albumId,
      t.discNumber,
      t.trackNumber,
      t.titleSort,
      t.path,
      t.id,
    ),
    index("genre_order_album_asc").on(
      t.genreId,
      t.albumSort,
      t.albumId,
      t.discNumber,
      t.trackNumber,
      t.titleSort,
      t.path,
      t.id,
    ),
    index("genre_order_album_desc").on(
      t.genreId,
      sql`${t.albumSort} desc`,
      t.albumId,
      t.discNumber,
      t.trackNumber,
      t.titleSort,
      t.path,
      t.id,
    ),
    index("genre_order_added_asc").on(
      t.genreId,
      t.addedAt,
      t.titleSort,
      t.artistSort,
      t.path,
      t.id,
    ),
    index("genre_order_added_desc").on(
      t.genreId,
      sql`${t.addedAt} desc`,
      t.titleSort,
      t.artistSort,
      t.path,
      t.id,
    ),
  ],
);

/**
 * How many times each genre's order has changed (#601): a paged read of it
 * started at one revision stops once another is written. Never reset, so a
 * page of a removed genre can't match a later one with its id.
 */
export const genreOrderRevisions = sqliteTable("genre_order_revisions", {
  genreId: integer("genre_id").primaryKey(),
  revision: integer("revision").notNull(),
});

/**
 * Follows are independent of the scanned library, so deleting files keeps them.
 * They sync with the Wave account; an unfollow is a tombstone (`deleted`).
 */
export const follows = sqliteTable("follows", {
  key: text("key").primaryKey(),
  name: text("name").notNull(),
  level: text("level").$type<import("@wave/core").FollowLevel>().notNull(),
  followedAt: integer("followed_at").notNull(),
  deezerId: integer("deezer_id"),
  ytBrowseId: text("yt_browse_id"),
  ...changeStamp(),
});

export const followReleaseCache = sqliteTable("follow_release_cache", {
  key: text("key").primaryKey(),
  releases: text("releases", { mode: "json" })
    .$type<import("@wave/core").FollowRelease[]>()
    .notNull(),
  checkedAt: integer("checked_at").notNull(),
});
/** Releases hidden from New from Artists You Follow, synced with the Wave account. */
export const hiddenFollowReleases = sqliteTable("hidden_follow_releases", {
  key: text("key").primaryKey(),
  ...changeStamp(),
});
/**
 * Follow suggestions the owner dismissed, by follow key (`followArtistKey`):
 * never suggested again. Undo leaves a tombstone (`deleted`), so the row has
 * the shape synced rows have.
 */
export const dismissedFollowSuggestions = sqliteTable("dismissed_follow_suggestions", {
  key: text("key").primaryKey(),
  dismissedAt: integer("dismissed_at").notNull(),
  ...changeStamp(),
});

export const followShowCache = sqliteTable("follow_show_cache", {
  key: text("key").primaryKey(),
  attractionId: text("attraction_id").notNull(),
  country: text("country").notNull(),
  shows: text("shows", { mode: "json" }).$type<import("@wave/core").FollowShow[]>().notNull(),
  checkedAt: integer("checked_at").notNull(),
});
/** Shows that notified here or on another phone of the Wave account, by Ticketmaster event id. */
export const notifiedFollowShows = sqliteTable("notified_follow_shows", {
  id: text("id").primaryKey(),
  ...changeStamp(),
});

/** Deezer genre answers for streamed songs; null records a completed lookup with no genre. */
export const streamedGenres = sqliteTable("streamed_genres", {
  videoId: text("video_id").primaryKey(),
  genre: text("genre"),
});

/**
 * ReccoBeats features for Library songs, found by the ISRC their file has (`tracks.isrc`), which
 * the row keeps: features of another ISRC stop counting. Phone-local, never synced.
 */
export const djLibraryMoodFeatures = sqliteTable("dj_library_mood_features", {
  trackId: integer("track_id")
    .primaryKey()
    .references(() => tracks.id, { onDelete: "cascade" }),
  isrc: text("isrc").notNull(),
  energy: real("energy"),
  valence: real("valence"),
  acousticness: real("acousticness"),
  mode: integer("mode"),
  checkedAt: integer("checked_at").notNull(),
});

/** ReccoBeats features for candidate catalog songs. Phone-local, keyed by YT Music video id. */
export const djMoodFeatures = sqliteTable("dj_mood_features", {
  videoId: text("video_id")
    .primaryKey()
    .references(() => candidateSongs.videoId, { onDelete: "cascade" }),
  isrc: text("isrc"),
  energy: real("energy"),
  valence: real("valence"),
  acousticness: real("acousticness"),
  mode: integer("mode"),
  checkedAt: integer("checked_at").notNull(),
  /** Lookups that failed in a row since the last answer (#1449): `DJ_MOOD_MAX_FAILURES` leaves it. */
  failures: integer("failures").notNull().default(0),
});
