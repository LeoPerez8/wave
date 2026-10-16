/**
 * Hand-written migrations in the shape drizzle-kit generates for Expo
 * (`{ journal, migrations: { m0000 } }`), consumed by
 * `drizzle-orm/expo-sqlite/migrator`. Each migration must match `schema.ts`.
 * Never edit a migration that has shipped; add a new one.
 */

const m0000 = `
CREATE TABLE \`artists\` (
	\`id\` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	\`key\` text NOT NULL,
	\`name\` text NOT NULL,
	\`sort\` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX \`artists_key_unique\` ON \`artists\` (\`key\`);
--> statement-breakpoint
CREATE INDEX \`artists_sort_idx\` ON \`artists\` (\`sort\`);
--> statement-breakpoint
CREATE TABLE \`genres\` (
	\`id\` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	\`key\` text NOT NULL,
	\`name\` text NOT NULL,
	\`sort\` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX \`genres_key_unique\` ON \`genres\` (\`key\`);
--> statement-breakpoint
CREATE INDEX \`genres_sort_idx\` ON \`genres\` (\`sort\`);
--> statement-breakpoint
CREATE TABLE \`folders\` (
	\`id\` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	\`path\` text NOT NULL,
	\`name\` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX \`folders_path_unique\` ON \`folders\` (\`path\`);
--> statement-breakpoint
CREATE TABLE \`artwork\` (
	\`hash\` text PRIMARY KEY NOT NULL,
	\`path\` text NOT NULL,
	\`thumb_path\` text NOT NULL,
	\`palette\` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE \`albums\` (
	\`id\` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	\`key\` text NOT NULL,
	\`title\` text NOT NULL,
	\`title_sort\` text NOT NULL,
	\`album_artist_id\` integer NOT NULL,
	\`year\` integer,
	\`artwork_hash\` text,
	\`compilation\` integer DEFAULT false NOT NULL,
	FOREIGN KEY (\`album_artist_id\`) REFERENCES \`artists\`(\`id\`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (\`artwork_hash\`) REFERENCES \`artwork\`(\`hash\`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX \`albums_key_unique\` ON \`albums\` (\`key\`);
--> statement-breakpoint
CREATE INDEX \`albums_title_sort_idx\` ON \`albums\` (\`title_sort\`);
--> statement-breakpoint
CREATE INDEX \`albums_album_artist_idx\` ON \`albums\` (\`album_artist_id\`);
--> statement-breakpoint
CREATE TABLE \`tracks\` (
	\`id\` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	\`path\` text NOT NULL,
	\`folder_id\` integer NOT NULL,
	\`file_name\` text NOT NULL,
	\`size_bytes\` integer NOT NULL,
	\`modified_at\` integer NOT NULL,
	\`title\` text NOT NULL,
	\`title_sort\` text NOT NULL,
	\`artist_id\` integer NOT NULL,
	\`album_id\` integer NOT NULL,
	\`genre_id\` integer,
	\`year\` integer,
	\`track_number\` integer,
	\`track_total\` integer,
	\`disc_number\` integer,
	\`disc_total\` integer,
	\`duration_ms\` integer NOT NULL,
	\`sample_rate\` integer,
	\`bitrate_kbps\` integer,
	\`artwork_hash\` text,
	\`added_at\` integer NOT NULL,
	\`scanned_at\` integer NOT NULL,
	FOREIGN KEY (\`folder_id\`) REFERENCES \`folders\`(\`id\`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (\`artist_id\`) REFERENCES \`artists\`(\`id\`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (\`album_id\`) REFERENCES \`albums\`(\`id\`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (\`genre_id\`) REFERENCES \`genres\`(\`id\`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (\`artwork_hash\`) REFERENCES \`artwork\`(\`hash\`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX \`tracks_path_unique\` ON \`tracks\` (\`path\`);
--> statement-breakpoint
CREATE INDEX \`tracks_title_sort_idx\` ON \`tracks\` (\`title_sort\`);
--> statement-breakpoint
CREATE INDEX \`tracks_artist_idx\` ON \`tracks\` (\`artist_id\`);
--> statement-breakpoint
CREATE INDEX \`tracks_album_idx\` ON \`tracks\` (\`album_id\`);
--> statement-breakpoint
CREATE INDEX \`tracks_genre_idx\` ON \`tracks\` (\`genre_id\`);
--> statement-breakpoint
CREATE INDEX \`tracks_folder_idx\` ON \`tracks\` (\`folder_id\`);
--> statement-breakpoint
CREATE TABLE \`scan_roots\` (
	\`path\` text PRIMARY KEY NOT NULL,
	\`added_at\` integer NOT NULL,
	\`last_scanned_at\` integer
);
--> statement-breakpoint
CREATE TABLE \`excluded_folders\` (
	\`path\` text PRIMARY KEY NOT NULL,
	\`added_at\` integer NOT NULL
);
`;

// Installs from before this migration only ever had the default Music root.
const m0001 = `
ALTER TABLE \`scan_roots\` ADD \`is_default\` integer DEFAULT false NOT NULL;
--> statement-breakpoint
UPDATE \`scan_roots\` SET \`is_default\` = true;
`;

const m0002 = `
CREATE TABLE \`playback_state\` (
	\`id\` integer PRIMARY KEY NOT NULL,
	\`queue\` text NOT NULL,
	\`position_ms\` integer DEFAULT 0 NOT NULL,
	\`updated_at\` integer NOT NULL
);
`;

const m0003 = `
CREATE TABLE \`recent_searches\` (
	\`query\` text PRIMARY KEY NOT NULL,
	\`searched_at\` integer NOT NULL
);
`;

const m0004 = `
CREATE TABLE \`playlists\` (
	\`id\` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	\`name\` text NOT NULL,
	\`created_at\` integer NOT NULL,
	\`updated_at\` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE \`playlist_items\` (
	\`id\` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	\`playlist_id\` integer NOT NULL,
	\`track_id\` integer NOT NULL,
	\`position\` integer NOT NULL,
	\`added_at\` integer NOT NULL,
	FOREIGN KEY (\`playlist_id\`) REFERENCES \`playlists\`(\`id\`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (\`track_id\`) REFERENCES \`tracks\`(\`id\`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX \`playlist_items_playlist_position_idx\` ON \`playlist_items\` (\`playlist_id\`,\`position\`);
--> statement-breakpoint
CREATE INDEX \`playlist_items_track_idx\` ON \`playlist_items\` (\`track_id\`);
--> statement-breakpoint
CREATE TABLE \`favorites\` (
	\`track_id\` integer PRIMARY KEY NOT NULL,
	\`added_at\` integer NOT NULL,
	FOREIGN KEY (\`track_id\`) REFERENCES \`tracks\`(\`id\`) ON UPDATE no action ON DELETE cascade
);
`;

// No foreign key on track_id: history outlives deleted files (see schema.ts).
const m0005 = `
CREATE TABLE \`play_events\` (
	\`id\` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	\`track_id\` integer NOT NULL,
	\`started_at\` integer NOT NULL,
	\`listened_ms\` integer NOT NULL,
	\`duration_ms\` integer,
	\`end_reason\` text NOT NULL,
	\`counted\` integer NOT NULL,
	\`context_type\` text,
	\`context_id\` text
);
--> statement-breakpoint
CREATE INDEX \`play_events_track_idx\` ON \`play_events\` (\`track_id\`);
--> statement-breakpoint
CREATE INDEX \`play_events_started_at_idx\` ON \`play_events\` (\`started_at\`);
`;

// Plays recorded before v2 came from the phone: Android Auto arrived with v2.
const m0006 = `
ALTER TABLE \`play_events\` ADD \`source\` text DEFAULT 'phone' NOT NULL;
`;

// Recounts every play on record under the 15-second rule, mirroring Core's
// \`isCountedPlay\` (COUNTED_PLAY_MS = 15000): more than 15 s listened, or a song
// of 15 s or less played to the end. The store test checks they agree.
const m0007 = `
UPDATE \`play_events\` SET \`counted\` = CASE
	WHEN \`listened_ms\` > 15000 THEN 1
	WHEN \`listened_ms\` > 0 AND \`end_reason\` = 'completed' AND \`duration_ms\` > 0 AND \`duration_ms\` <= 15000 THEN 1
	ELSE 0
END;
`;

// Artist images (Core's \`artistArtwork\`): filled in by the store after the
// next scan, so artists show their placeholder until then.
const m0008 = `
ALTER TABLE \`artists\` ADD \`artwork_hash\` text REFERENCES \`artwork\`(\`hash\`);
`;

// Artist photos (docs/spec.md): downloaded files and misses, by artist key.
const m0009 = `
CREATE TABLE \`artist_photos\` (
	\`artist_key\` text PRIMARY KEY NOT NULL,
	\`outcome\` text NOT NULL,
	\`checked_at\` integer NOT NULL,
	\`path\` text,
	\`thumb_path\` text
);
`;

// Plays keep their song's album and track artist once the song leaves the
// library (written then, by the store), so deleting songs doesn't change Stats.
const m0010 = `
ALTER TABLE \`play_events\` ADD \`album_id\` integer;
--> statement-breakpoint
ALTER TABLE \`play_events\` ADD \`artist_id\` integer;
`;

// Whether each song has lyrics (tags or sidecar), for the whole-Library lyrics
// and genre run. Only a scan can tell, so every indexed file is marked as
// changed (modified_at 0): the next scan reads them all again.
const m0011 = `
ALTER TABLE \`tracks\` ADD \`has_lyrics\` integer DEFAULT false NOT NULL;
--> statement-breakpoint
UPDATE \`tracks\` SET \`modified_at\` = 0;
`;

// A song credited to several artists belongs to each of them (docs/spec.md,
// glossary: Artist). Tracks and albums keep their credit as written, read from
// the whole-credit artist they had; the store then splits every credit into
// its artists and links them (`relinkCreditsIfUnlinked`), with no rescan.
const m0012 = `
ALTER TABLE \`tracks\` ADD \`artist_credit\` text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE \`albums\` ADD \`album_artist_credit\` text DEFAULT '' NOT NULL;
--> statement-breakpoint
UPDATE \`tracks\` SET \`artist_credit\` = (SELECT \`name\` FROM \`artists\` WHERE \`artists\`.\`id\` = \`tracks\`.\`artist_id\`);
--> statement-breakpoint
UPDATE \`albums\` SET \`album_artist_credit\` = (SELECT \`name\` FROM \`artists\` WHERE \`artists\`.\`id\` = \`albums\`.\`album_artist_id\`);
--> statement-breakpoint
CREATE TABLE \`track_artists\` (
	\`track_id\` integer NOT NULL,
	\`artist_id\` integer NOT NULL,
	\`position\` integer NOT NULL,
	PRIMARY KEY(\`track_id\`, \`position\`),
	FOREIGN KEY (\`track_id\`) REFERENCES \`tracks\`(\`id\`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (\`artist_id\`) REFERENCES \`artists\`(\`id\`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX \`track_artists_artist_idx\` ON \`track_artists\` (\`artist_id\`);
--> statement-breakpoint
CREATE TABLE \`album_artists\` (
	\`album_id\` integer NOT NULL,
	\`artist_id\` integer NOT NULL,
	\`position\` integer NOT NULL,
	PRIMARY KEY(\`album_id\`, \`position\`),
	FOREIGN KEY (\`album_id\`) REFERENCES \`albums\`(\`id\`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (\`artist_id\`) REFERENCES \`artists\`(\`id\`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX \`album_artists_artist_idx\` ON \`album_artists\` (\`artist_id\`);
`;

// A deleted song's plays count for every artist its credit named (docs/spec.md,
// glossary: Artist), not only one: the store keeps them in
// \`deleted_track_artists\`. Songs deleted before keep the one artist their plays
// held (\`relinkCredits\` splits a whole credit among its artists once it's pruned).
const m0013 = `
CREATE TABLE \`deleted_track_artists\` (
	\`track_id\` integer NOT NULL,
	\`artist_id\` integer NOT NULL,
	\`position\` integer NOT NULL,
	PRIMARY KEY(\`track_id\`, \`position\`),
	FOREIGN KEY (\`artist_id\`) REFERENCES \`artists\`(\`id\`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX \`deleted_track_artists_artist_idx\` ON \`deleted_track_artists\` (\`artist_id\`);
--> statement-breakpoint
INSERT INTO \`deleted_track_artists\` (\`track_id\`, \`artist_id\`, \`position\`)
	SELECT \`track_id\`, min(\`artist_id\`), 0 FROM \`play_events\`
	WHERE \`artist_id\` IN (SELECT \`id\` FROM \`artists\`)
		AND \`track_id\` NOT IN (SELECT \`id\` FROM \`tracks\`)
	GROUP BY \`track_id\`;
--> statement-breakpoint
ALTER TABLE \`play_events\` DROP COLUMN \`artist_id\`;
`;

// The artist page's YT Music section (docs/spec.md, "YT Music"): the last
// answer for each artist, by artist key, shown for a week without asking again.
const m0014 = `
CREATE TABLE \`yt_artists\` (
	\`artist_key\` text PRIMARY KEY NOT NULL,
	\`outcome\` text NOT NULL,
	\`checked_at\` integer NOT NULL,
	\`browse_id\` text,
	\`page\` text
);
`;

// A tag's separate values are separate credits (docs/spec.md, glossary:
// Credit): tracks and albums keep each of them, so "Ariana Grande" and "Social
// House" never make one artist. Null is a single credit, the one written.
// The store still files the Library under its artists from the credits
// already stored (no rescan), but only a scan reads a tag's every value, so
// every indexed file is marked as changed (modified_at 0) as in 0011: the
// next scan reads them all again.
const m0015 = `
ALTER TABLE \`tracks\` ADD \`artist_credits\` text;
--> statement-breakpoint
ALTER TABLE \`albums\` ADD \`album_artist_credits\` text;
--> statement-breakpoint
UPDATE \`tracks\` SET \`modified_at\` = 0;
`;

// A playlist keeps songs the Library doesn't have (docs/spec.md, "Playlists"):
// an item is a Library track or a YT Music song (`yt_song`, Core's
// `writePlaylistYtSong`), never both. SQLite can't drop NOT NULL from a
// column, so the table is rebuilt; existing items keep their ids and places.
// Self-contained (no other migration's tables or columns), so it can take any
// number when merged.
const mPlaylistYtEntries = `
CREATE TABLE \`__new_playlist_items\` (
	\`id\` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	\`playlist_id\` integer NOT NULL,
	\`track_id\` integer,
	\`yt_song\` text,
	\`position\` integer NOT NULL,
	\`added_at\` integer NOT NULL,
	FOREIGN KEY (\`playlist_id\`) REFERENCES \`playlists\`(\`id\`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (\`track_id\`) REFERENCES \`tracks\`(\`id\`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "playlist_items_one_song" CHECK((\`track_id\` IS NULL) <> (\`yt_song\` IS NULL))
);
--> statement-breakpoint
INSERT INTO \`__new_playlist_items\` (\`id\`, \`playlist_id\`, \`track_id\`, \`position\`, \`added_at\`)
	SELECT \`id\`, \`playlist_id\`, \`track_id\`, \`position\`, \`added_at\` FROM \`playlist_items\`;
--> statement-breakpoint
DROP TABLE \`playlist_items\`;
--> statement-breakpoint
ALTER TABLE \`__new_playlist_items\` RENAME TO \`playlist_items\`;
--> statement-breakpoint
CREATE INDEX \`playlist_items_playlist_position_idx\` ON \`playlist_items\` (\`playlist_id\`,\`position\`);
--> statement-breakpoint
CREATE INDEX \`playlist_items_track_idx\` ON \`playlist_items\` (\`track_id\`);
`;

// Plays imported from BlackPlayer's track stats (docs/spec.md, "Importing
// BlackPlayer stats"): marked, so an import never adds the same plays twice.
// Wave's own plays are null.
const mImportedPlays = `
ALTER TABLE \`play_events\` ADD \`imported_from\` text;
`;

// What the Wave account needs to know songs across phones and merge rows
// (docs/spec.md, "Wave account and sync"):
// - this install's phone id (\`phone\`), random;
// - tracks: a recording key and a YouTube video id, and a path that can be
//   null (a missing song). SQLite can't drop NOT NULL, so \`tracks\` is rebuilt
//   with its ids and the AUTOINCREMENT counter (a deleted song's plays keep
//   an id no new song takes). Dropping it with foreign keys on (the migrator
//   runs in one transaction, where the pragma can't change) deletes the rows
//   that reference it, so its credit links, stars and playlist entries are
//   copied aside first and put back;
// - playlists and entries: an id made on the phone (\`sync_id\`); entries an
//   order key instead of a position, given in their current order: the
//   keys adding them one by one at the end makes (Core's \`orderKeyBetween\`:
//   \`a0\`…\`az\`, \`b00\`…\`bzz\`, \`c000\`…);
// - playlists, entries and stars: when they last changed and on which phone
//   (\`changed_at\`, \`phone_id\`), and \`deleted\` for tombstones. Existing rows
//   are stamped by this phone, when they were last changed or made;
// - plays: the recording key, filled in by the store once it has keyed the
//   tracks (\`keyRecordings\`); plays of songs deleted before keep none;
// - when each synced preference last changed (\`preference_changes\`).
const mSyncIdentity = `
CREATE TABLE \`phone\` (
	\`id\` integer PRIMARY KEY NOT NULL,
	\`phone_id\` text NOT NULL
);
--> statement-breakpoint
INSERT INTO \`phone\` (\`id\`, \`phone_id\`) VALUES (1, lower(hex(randomblob(16))));
--> statement-breakpoint
CREATE TABLE \`__keep_sequence\` AS SELECT \`name\`, \`seq\` FROM \`sqlite_sequence\`
	WHERE \`name\` IN ('tracks', 'playlists', 'playlist_items');
--> statement-breakpoint
CREATE TABLE \`__keep_track_artists\` AS SELECT * FROM \`track_artists\`;
--> statement-breakpoint
CREATE TABLE \`__keep_favorites\` AS SELECT * FROM \`favorites\`;
--> statement-breakpoint
CREATE TABLE \`__keep_playlists\` AS SELECT * FROM \`playlists\`;
--> statement-breakpoint
CREATE TABLE \`__keep_playlist_items\` AS SELECT * FROM \`playlist_items\`;
--> statement-breakpoint
DROP TABLE \`favorites\`;
--> statement-breakpoint
DROP TABLE \`playlist_items\`;
--> statement-breakpoint
DROP TABLE \`playlists\`;
--> statement-breakpoint
CREATE TABLE \`__new_tracks\` (
	\`id\` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	\`path\` text,
	\`recording_key\` text,
	\`video_id\` text,
	\`folder_id\` integer NOT NULL,
	\`file_name\` text NOT NULL,
	\`size_bytes\` integer NOT NULL,
	\`modified_at\` integer NOT NULL,
	\`title\` text NOT NULL,
	\`title_sort\` text NOT NULL,
	\`artist_id\` integer NOT NULL,
	\`artist_credit\` text DEFAULT '' NOT NULL,
	\`artist_credits\` text,
	\`album_id\` integer NOT NULL,
	\`genre_id\` integer,
	\`year\` integer,
	\`track_number\` integer,
	\`track_total\` integer,
	\`disc_number\` integer,
	\`disc_total\` integer,
	\`duration_ms\` integer NOT NULL,
	\`sample_rate\` integer,
	\`bitrate_kbps\` integer,
	\`artwork_hash\` text,
	\`has_lyrics\` integer DEFAULT false NOT NULL,
	\`added_at\` integer NOT NULL,
	\`scanned_at\` integer NOT NULL,
	FOREIGN KEY (\`folder_id\`) REFERENCES \`folders\`(\`id\`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (\`artist_id\`) REFERENCES \`artists\`(\`id\`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (\`album_id\`) REFERENCES \`albums\`(\`id\`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (\`genre_id\`) REFERENCES \`genres\`(\`id\`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (\`artwork_hash\`) REFERENCES \`artwork\`(\`hash\`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO \`__new_tracks\` (\`id\`, \`path\`, \`folder_id\`, \`file_name\`, \`size_bytes\`, \`modified_at\`, \`title\`, \`title_sort\`, \`artist_id\`, \`artist_credit\`, \`artist_credits\`, \`album_id\`, \`genre_id\`, \`year\`, \`track_number\`, \`track_total\`, \`disc_number\`, \`disc_total\`, \`duration_ms\`, \`sample_rate\`, \`bitrate_kbps\`, \`artwork_hash\`, \`has_lyrics\`, \`added_at\`, \`scanned_at\`)
	SELECT \`id\`, \`path\`, \`folder_id\`, \`file_name\`, \`size_bytes\`, \`modified_at\`, \`title\`, \`title_sort\`, \`artist_id\`, \`artist_credit\`, \`artist_credits\`, \`album_id\`, \`genre_id\`, \`year\`, \`track_number\`, \`track_total\`, \`disc_number\`, \`disc_total\`, \`duration_ms\`, \`sample_rate\`, \`bitrate_kbps\`, \`artwork_hash\`, \`has_lyrics\`, \`added_at\`, \`scanned_at\` FROM \`tracks\`;
--> statement-breakpoint
DROP TABLE \`tracks\`;
--> statement-breakpoint
ALTER TABLE \`__new_tracks\` RENAME TO \`tracks\`;
--> statement-breakpoint
CREATE UNIQUE INDEX \`tracks_path_unique\` ON \`tracks\` (\`path\`);
--> statement-breakpoint
CREATE INDEX \`tracks_title_sort_idx\` ON \`tracks\` (\`title_sort\`);
--> statement-breakpoint
CREATE INDEX \`tracks_artist_idx\` ON \`tracks\` (\`artist_id\`);
--> statement-breakpoint
CREATE INDEX \`tracks_album_idx\` ON \`tracks\` (\`album_id\`);
--> statement-breakpoint
CREATE INDEX \`tracks_genre_idx\` ON \`tracks\` (\`genre_id\`);
--> statement-breakpoint
CREATE INDEX \`tracks_folder_idx\` ON \`tracks\` (\`folder_id\`);
--> statement-breakpoint
CREATE INDEX \`tracks_recording_key_idx\` ON \`tracks\` (\`recording_key\`);
--> statement-breakpoint
INSERT INTO \`track_artists\` (\`track_id\`, \`artist_id\`, \`position\`)
	SELECT \`track_id\`, \`artist_id\`, \`position\` FROM \`__keep_track_artists\`;
--> statement-breakpoint
CREATE TABLE \`playlists\` (
	\`id\` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	\`sync_id\` text NOT NULL,
	\`name\` text NOT NULL,
	\`created_at\` integer NOT NULL,
	\`updated_at\` integer NOT NULL,
	\`changed_at\` integer NOT NULL,
	\`phone_id\` text NOT NULL,
	\`deleted\` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX \`playlists_sync_id_unique\` ON \`playlists\` (\`sync_id\`);
--> statement-breakpoint
CREATE INDEX \`playlists_changed_at_idx\` ON \`playlists\` (\`changed_at\`);
--> statement-breakpoint
INSERT INTO \`playlists\` (\`id\`, \`sync_id\`, \`name\`, \`created_at\`, \`updated_at\`, \`changed_at\`, \`phone_id\`)
	SELECT \`id\`, lower(hex(randomblob(16))), \`name\`, \`created_at\`, \`updated_at\`, \`updated_at\`,
		(SELECT \`phone_id\` FROM \`phone\`)
	FROM \`__keep_playlists\`;
--> statement-breakpoint
CREATE TABLE \`playlist_items\` (
	\`id\` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	\`sync_id\` text NOT NULL,
	\`playlist_id\` integer NOT NULL,
	\`track_id\` integer,
	\`yt_song\` text,
	\`order_key\` text NOT NULL,
	\`added_at\` integer NOT NULL,
	\`changed_at\` integer NOT NULL,
	\`phone_id\` text NOT NULL,
	\`deleted\` integer DEFAULT false NOT NULL,
	FOREIGN KEY (\`playlist_id\`) REFERENCES \`playlists\`(\`id\`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (\`track_id\`) REFERENCES \`tracks\`(\`id\`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "playlist_items_one_song" CHECK((\`track_id\` IS NULL) <> (\`yt_song\` IS NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX \`playlist_items_sync_id_unique\` ON \`playlist_items\` (\`sync_id\`);
--> statement-breakpoint
CREATE INDEX \`playlist_items_playlist_order_idx\` ON \`playlist_items\` (\`playlist_id\`,\`order_key\`,\`sync_id\`);
--> statement-breakpoint
CREATE INDEX \`playlist_items_track_idx\` ON \`playlist_items\` (\`track_id\`);
--> statement-breakpoint
CREATE INDEX \`playlist_items_changed_at_idx\` ON \`playlist_items\` (\`changed_at\`);
--> statement-breakpoint
INSERT INTO \`playlist_items\` (\`id\`, \`sync_id\`, \`playlist_id\`, \`track_id\`, \`yt_song\`, \`order_key\`, \`added_at\`, \`changed_at\`, \`phone_id\`)
	SELECT \`id\`, lower(hex(randomblob(16))), \`playlist_id\`, \`track_id\`, \`yt_song\`,
		CASE
			WHEN \`rank\` < 62 THEN 'a' || substr(\`digits\`, \`rank\` + 1, 1)
			WHEN \`rank\` < 3906 THEN 'b'
				|| substr(\`digits\`, (\`rank\` - 62) / 62 + 1, 1)
				|| substr(\`digits\`, (\`rank\` - 62) % 62 + 1, 1)
			ELSE 'c'
				|| substr(\`digits\`, (\`rank\` - 3906) / 3844 + 1, 1)
				|| substr(\`digits\`, (\`rank\` - 3906) / 62 % 62 + 1, 1)
				|| substr(\`digits\`, (\`rank\` - 3906) % 62 + 1, 1)
		END,
		\`added_at\`, \`added_at\`, (SELECT \`phone_id\` FROM \`phone\`)
	FROM (
		SELECT *,
			row_number() OVER (PARTITION BY \`playlist_id\` ORDER BY \`position\`, \`id\`) - 1 AS \`rank\`,
			'0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz' AS \`digits\`
		FROM \`__keep_playlist_items\`
	);
--> statement-breakpoint
CREATE TABLE \`favorites\` (
	\`track_id\` integer PRIMARY KEY NOT NULL,
	\`added_at\` integer NOT NULL,
	\`changed_at\` integer NOT NULL,
	\`phone_id\` text NOT NULL,
	\`deleted\` integer DEFAULT false NOT NULL,
	FOREIGN KEY (\`track_id\`) REFERENCES \`tracks\`(\`id\`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX \`favorites_changed_at_idx\` ON \`favorites\` (\`changed_at\`);
--> statement-breakpoint
INSERT INTO \`favorites\` (\`track_id\`, \`added_at\`, \`changed_at\`, \`phone_id\`)
	SELECT \`track_id\`, \`added_at\`, \`added_at\`, (SELECT \`phone_id\` FROM \`phone\`) FROM \`__keep_favorites\`;
--> statement-breakpoint
UPDATE \`sqlite_sequence\` SET \`seq\` = max(\`seq\`, (SELECT \`k\`.\`seq\` FROM \`__keep_sequence\` \`k\` WHERE \`k\`.\`name\` = \`sqlite_sequence\`.\`name\`))
	WHERE \`name\` IN (SELECT \`name\` FROM \`__keep_sequence\`);
--> statement-breakpoint
INSERT INTO \`sqlite_sequence\` (\`name\`, \`seq\`)
	SELECT \`name\`, \`seq\` FROM \`__keep_sequence\`
	WHERE \`name\` NOT IN (SELECT \`name\` FROM \`sqlite_sequence\`);
--> statement-breakpoint
DROP TABLE \`__keep_sequence\`;
--> statement-breakpoint
DROP TABLE \`__keep_track_artists\`;
--> statement-breakpoint
DROP TABLE \`__keep_favorites\`;
--> statement-breakpoint
DROP TABLE \`__keep_playlists\`;
--> statement-breakpoint
DROP TABLE \`__keep_playlist_items\`;
--> statement-breakpoint
ALTER TABLE \`play_events\` ADD \`recording_key\` text;
--> statement-breakpoint
CREATE TABLE \`preference_changes\` (
	\`key\` text PRIMARY KEY NOT NULL,
	\`changed_at\` integer NOT NULL,
	\`phone_id\` text NOT NULL
);
`;

// What syncing with the Wave account keeps (docs/spec.md, "Wave account and sync"):
// - plays: an id that is the same on every phone (\`sync_id\`; Wave's own plays get
//   a random one here, imported ones get theirs from the store once their songs
//   are keyed), and which play is going on now (\`ongoing\`: the latest of Wave's
//   own, which the player may still be on);
// - whether each synced row's last change is on the account (\`pushed\`): none yet;
// - the account's songs as this phone knows them (\`account_songs\`), the rows it
//   sent that wait for a song or a playlist (\`sync_pending\`), and where syncing
//   stands (\`sync_state\`: no account joined yet).
const mSyncState = `
ALTER TABLE \`play_events\` ADD \`sync_id\` text;
--> statement-breakpoint
ALTER TABLE \`play_events\` ADD \`ongoing\` integer DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE \`play_events\` ADD \`pushed\` integer DEFAULT false NOT NULL;
--> statement-breakpoint
UPDATE \`play_events\` SET \`sync_id\` = lower(hex(randomblob(16))) WHERE \`imported_from\` IS NULL;
--> statement-breakpoint
UPDATE \`play_events\` SET \`ongoing\` = true
	WHERE \`id\` = (SELECT max(\`id\`) FROM \`play_events\` WHERE \`imported_from\` IS NULL);
--> statement-breakpoint
CREATE UNIQUE INDEX \`play_events_sync_id_unique\` ON \`play_events\` (\`sync_id\`);
--> statement-breakpoint
CREATE INDEX \`play_events_pushed_idx\` ON \`play_events\` (\`pushed\`);
--> statement-breakpoint
ALTER TABLE \`playlists\` ADD \`pushed\` integer DEFAULT false NOT NULL;
--> statement-breakpoint
CREATE INDEX \`playlists_pushed_idx\` ON \`playlists\` (\`pushed\`);
--> statement-breakpoint
ALTER TABLE \`playlist_items\` ADD \`pushed\` integer DEFAULT false NOT NULL;
--> statement-breakpoint
CREATE INDEX \`playlist_items_pushed_idx\` ON \`playlist_items\` (\`pushed\`);
--> statement-breakpoint
ALTER TABLE \`favorites\` ADD \`pushed\` integer DEFAULT false NOT NULL;
--> statement-breakpoint
CREATE INDEX \`favorites_pushed_idx\` ON \`favorites\` (\`pushed\`);
--> statement-breakpoint
ALTER TABLE \`preference_changes\` ADD \`pushed\` integer DEFAULT false NOT NULL;
--> statement-breakpoint
CREATE TABLE \`account_songs\` (
	\`recording_key\` text PRIMARY KEY NOT NULL,
	\`song\` text,
	\`changed_at\` integer NOT NULL,
	\`phone_id\` text NOT NULL,
	\`deleted\` integer DEFAULT false NOT NULL,
	\`pushed\` integer DEFAULT false NOT NULL,
	\`local\` text
);
--> statement-breakpoint
CREATE INDEX \`account_songs_pushed_idx\` ON \`account_songs\` (\`pushed\`);
--> statement-breakpoint
CREATE TABLE \`sync_pending\` (
	\`kind\` text NOT NULL,
	\`id\` text NOT NULL,
	\`song_key\` text,
	\`playlist_key\` text,
	\`row\` text NOT NULL,
	PRIMARY KEY(\`kind\`, \`id\`)
);
--> statement-breakpoint
CREATE INDEX \`sync_pending_song_idx\` ON \`sync_pending\` (\`song_key\`);
--> statement-breakpoint
CREATE INDEX \`sync_pending_playlist_idx\` ON \`sync_pending\` (\`playlist_key\`);
--> statement-breakpoint
CREATE TABLE \`sync_state\` (
	\`id\` integer PRIMARY KEY NOT NULL,
	\`account\` text,
	\`cursor\` text
);
--> statement-breakpoint
INSERT INTO \`sync_state\` (\`id\`) VALUES (1);
`;

// Removals whose rows went with their song, waiting to go up as tombstones
// (\`sync_removals\`): a removed song's star and entries, a retagged song's old star.
const mSyncRemovals = `
CREATE TABLE \`sync_removals\` (
	\`kind\` text NOT NULL,
	\`id\` text NOT NULL,
	\`changed_at\` integer NOT NULL,
	\`phone_id\` text NOT NULL,
	PRIMARY KEY(\`kind\`, \`id\`)
);
`;

// A playlist's own image, shown in place of its mosaic. It stays on this phone.
const mPlaylistImages = `
ALTER TABLE \`playlists\` ADD \`image_path\` text;
--> statement-breakpoint
ALTER TABLE \`playlists\` ADD \`image_thumb_path\` text;
`;

export default {
  journal: {
    entries: [
      { idx: 0, when: 1_791_806_400_000, tag: "0000_library", breakpoints: true },
      { idx: 1, when: 1_791_892_800_000, tag: "0001_default_scan_root", breakpoints: true },
      { idx: 2, when: 1_791_979_200_000, tag: "0002_playback_state", breakpoints: true },
      { idx: 3, when: 1_792_065_600_000, tag: "0003_recent_searches", breakpoints: true },
      { idx: 4, when: 1_792_152_000_000, tag: "0004_playlists_favorites", breakpoints: true },
      { idx: 5, when: 1_792_238_400_000, tag: "0005_play_events", breakpoints: true },
      { idx: 6, when: 1_792_324_800_000, tag: "0006_play_source", breakpoints: true },
      { idx: 7, when: 1_792_411_200_000, tag: "0007_recount_plays", breakpoints: true },
      { idx: 8, when: 1_792_497_600_000, tag: "0008_artist_images", breakpoints: true },
      { idx: 9, when: 1_792_584_000_000, tag: "0009_artist_photos", breakpoints: true },
      { idx: 10, when: 1_792_670_400_000, tag: "0010_play_credits", breakpoints: true },
      { idx: 11, when: 1_792_756_800_000, tag: "0011_track_lyrics", breakpoints: true },
      { idx: 12, when: 1_792_843_200_000, tag: "0012_artist_credits", breakpoints: true },
      { idx: 13, when: 1_792_929_600_000, tag: "0013_deleted_track_artists", breakpoints: true },
      { idx: 14, when: 1_793_016_000_000, tag: "0014_yt_artists", breakpoints: true },
      { idx: 15, when: 1_793_102_400_000, tag: "0015_tag_credits", breakpoints: true },
      { idx: 16, when: 1_793_188_800_000, tag: "0016_playlist_yt_entries", breakpoints: true },
      { idx: 17, when: 1_793_275_200_000, tag: "0017_imported_plays", breakpoints: true },
      { idx: 18, when: 1_793_361_600_000, tag: "0018_sync_identity", breakpoints: true },
      { idx: 19, when: 1_793_448_000_000, tag: "0019_sync_state", breakpoints: true },
      { idx: 20, when: 1_793_534_400_000, tag: "0020_sync_removals", breakpoints: true },
      { idx: 21, when: 1_793_620_800_000, tag: "0021_playlist_images", breakpoints: true },
    ],
  },
  migrations: {
    m0000,
    m0001,
    m0002,
    m0003,
    m0004,
    m0005,
    m0006,
    m0007,
    m0008,
    m0009,
    m0010,
    m0011,
    m0012,
    m0013,
    m0014,
    m0015,
    m0016: mPlaylistYtEntries,
    m0017: mImportedPlays,
    m0018: mSyncIdentity,
    m0019: mSyncState,
    m0020: mSyncRemovals,
    m0021: mPlaylistImages,
  },
};
