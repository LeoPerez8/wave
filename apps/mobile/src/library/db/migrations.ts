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
CREATE TABLE \`recent_searches\` (
	\`query\` text PRIMARY KEY NOT NULL,
	\`searched_at\` integer NOT NULL
);
`;

export default {
  journal: {
    entries: [
      { idx: 0, when: 1_791_806_400_000, tag: "0000_library", breakpoints: true },
      { idx: 1, when: 1_791_892_800_000, tag: "0001_default_scan_root", breakpoints: true },
      { idx: 2, when: 1_791_979_200_000, tag: "0002_recent_searches", breakpoints: true },
    ],
  },
  migrations: { m0000, m0001, m0002 },
};
