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

// Plays imported from BlackPlayer's track stats (docs/spec.md, "Importing
// BlackPlayer stats"): marked, so an import never adds the same plays twice.
// Wave's own plays are null.
const mImportedPlays = `
ALTER TABLE \`play_events\` ADD \`imported_from\` text;
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
      { idx: 16, when: 1_793_188_800_000, tag: "0016_imported_plays", breakpoints: true },
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
    m0016: mImportedPlays,
  },
};
