/**
 * What the app and the sync service send each other (docs/spec.md, "Wave
 * account and sync"; the shapes are `apps/sync/README.md`'s): the synced
 * rows by table, how a push is cut into batches the service takes, and
 * reading a pull's answer.
 */

import type { FollowLevel } from "./followedArtists.ts";
import type { SyncRow } from "./sync.ts";
import type { PlaySnapshot } from "./listeningHistory.ts";
import type { PlaySource } from "./playEvents.ts";

/** A synced row with its table's own [Fields], or a tombstone, which carries none. */
export type SyncedRow<Fields> =
  (SyncRow & { readonly deleted: false } & Fields) | (SyncRow & { readonly deleted: true });

/** A song as the account knows it; its id is its recording key. */
export interface SyncSongFields {
  readonly title: string;
  /** The artist credit as written. */
  readonly credit: string;
  readonly album: string | null;
  /** The album artist credit as written. */
  readonly albumArtist: string;
  readonly discNumber: number | null;
  readonly trackNumber: number | null;
  readonly durationMs: number;
  readonly releaseDate?: string | null | undefined;
  readonly year: number | null;
  readonly genre: string | null;
  /** The YouTube video id of a song downloaded from YouTube Music. */
  readonly videoId: string | null;
  /** When it entered the Library. */
  readonly addedAt: number;
}

export type SyncSong = SyncedRow<SyncSongFields>;

/** A playlist; its id is made on the phone that created it. */
export type SyncPlaylist = SyncedRow<{ readonly name: string; readonly createdAt: number }>;

/**
 * A playlist entry: a Library song by recording key, or a stored song.
 * A manual removal keeps its fields on the tombstone for the Graveyard.
 */
export type SyncPlaylistEntry =
  | SyncedRow<SyncPlaylistEntryFields>
  | (SyncRow & { readonly deleted: true; readonly removedAt: number } & SyncPlaylistEntryFields);

interface SyncPlaylistEntryFields {
  /** The playlist's id. */
  readonly playlistId: string;
  /** Core's `orderKeyBetween`. */
  readonly orderKey: string;
  /** The song's recording key, for a Library song. */
  readonly songId: string | null;
  /** A YT Music entry's song (`writePlaylistYtSong`). */
  readonly ytSong: string | null;
  readonly addedAt: number;
  readonly removedAt?: number | null;
  /** When Restore or Undo last brought the entry back (Core's `SyncEntryRow`). */
  readonly restoredAt?: number | null;
  /**
   * A Library song's own fields, so the other members of a collaborative
   * playlist can match it to their Tracks: its title, artist credit, album,
   * length and YouTube video id (docs/spec.md, Collaborative playlists,
   * "Library songs"). Absent from an app from before them.
   */
  readonly title?: string | null;
  readonly credit?: string | null;
  readonly album?: string | null;
  readonly durationMs?: number | null;
  readonly videoId?: string | null;
  /**
   * The account that added the entry, written by the service from the
   * session that first pushed it; whatever an app sends is ignored. Null
   * for an entry from before it, or of an account that was deleted.
   */
  readonly addedBy?: string | null;
}

/** A star; its id is the song's recording key. */
export type SyncFavorite = SyncedRow<{ readonly addedAt: number }>;

/**
 * A synced preference; its id is its key-value store key, and its value is
 * what the key-value store holds for it (null: nothing, its default).
 */
export type SyncPreference = SyncedRow<{ readonly value: string | null }>;

/** A follow; its id is the artist's `followArtistKey`. */
export type SyncFollow = SyncedRow<{
  /** The artist's name as first followed. */
  readonly name: string;
  readonly level: FollowLevel;
  readonly followedAt: number;
  readonly deezerId: number | null;
  readonly ytBrowseId: string | null;
}>;

/** A New release the owner hid; its id is the release key (`deezer:<albumId>`). */
export type SyncHiddenRelease = SyncedRow<Readonly<Record<never, never>>>;

/** A Show that already notified on some phone; its id is the Ticketmaster event id. */
export type SyncNotifiedShow = SyncedRow<Readonly<Record<never, never>>>;

/**
 * A follow suggestion the owner dismissed; its id is the artist's
 * `followArtistKey`. Undo leaves a tombstone.
 */
export type SyncDismissedSuggestion = SyncedRow<{ readonly dismissedAt: number }>;

/**
 * A dislike; its id is the song's recording key, or a YT Music song's queue
 * track id (`yt:<video>`) when the Library has no file of it. It carries the
 * song as it was listed when disliked, for the Disliked songs list.
 */
export type SyncDislike = SyncedRow<{
  readonly title: string;
  /** Who it's credited to, primary first: a JSON array of names. */
  readonly artists: string;
  readonly durationMs: number | null;
  readonly dislikedAt: number;
}>;

/** How a play ended (Core's `PlayEndReason`). */
export type SyncPlayEnd = "completed" | "skipped" | "stopped" | "interrupted";

/** A play event; only ever added, its id made by the device that recorded it. */
export interface SyncPlayRow {
  readonly id: string;
  /** The song's recording key. */
  readonly songId: string;
  readonly startedAt: number;
  readonly listenedMs: number;
  readonly durationMs: number | null;
  readonly endReason: SyncPlayEnd;
  readonly counted: boolean;
  readonly contextType: string | null;
  readonly contextId: string | null;
  /**
   * The playlist's sync id when the play context is a playlist: `contextId`
   * is then the playlist's number on the device that recorded the play, which
   * names another playlist elsewhere. Absent on older clients.
   */
  readonly contextPlaylistId?: string | null;
  readonly source: PlaySource;
  readonly importedFrom: "blackplayer" | null;
  /** What the play showed when it started; absent on older clients. */
  readonly snapshot?: PlaySnapshot | null;
  /** A streamed play's YouTube video id; songId remains its recording key. */
  readonly videoId?: string | null;
}

/** Rows by table, as a push sends them and a pull answers them. */
export interface SyncTables {
  readonly songs: readonly SyncSong[];
  readonly playlists: readonly SyncPlaylist[];
  readonly playlistEntries: readonly SyncPlaylistEntry[];
  readonly favorites: readonly SyncFavorite[];
  readonly preferences: readonly SyncPreference[];
  readonly plays: readonly SyncPlayRow[];
  readonly follows: readonly SyncFollow[];
  readonly hiddenReleases: readonly SyncHiddenRelease[];
  readonly notifiedShows: readonly SyncNotifiedShow[];
  readonly dismissedSuggestions: readonly SyncDismissedSuggestion[];
  readonly dislikes: readonly SyncDislike[];
}

export const EMPTY_SYNC_TABLES: SyncTables = {
  songs: [],
  playlists: [],
  playlistEntries: [],
  favorites: [],
  preferences: [],
  plays: [],
  follows: [],
  hiddenReleases: [],
  notifiedShows: [],
  dismissedSuggestions: [],
  dislikes: [],
};

/**
 * The tables in the order a push sends them: songs and playlists before the
 * rows that point at them.
 */
export const SYNC_TABLE_NAMES = [
  "songs",
  "playlists",
  "playlistEntries",
  "favorites",
  "preferences",
  "plays",
  "follows",
  "hiddenReleases",
  "notifiedShows",
  "dismissedSuggestions",
  "dislikes",
] as const satisfies readonly (keyof SyncTables)[];

/** What one field holds: text, a whole number, a boolean, or one of a few values; `?` allows null. */
export type SyncFieldKind =
  "text" | "text?" | "int" | "int?" | "bool" | "snapshot?" | readonly (string | null)[];

/**
 * Each table's own fields, as `readPullPage` checks them and the sync
 * service checks a push (its `SYNC_TABLES` are built from them).
 */
export const SYNC_FIELDS: {
  readonly [K in keyof SyncTables]: Readonly<Record<string, SyncFieldKind>>;
} = {
  songs: {
    // not UI text: a wire field kind
    title: "text",
    credit: "text",
    album: "text?",
    albumArtist: "text",
    discNumber: "int?",
    trackNumber: "int?",
    durationMs: "int",
    releaseDate: "text?",
    year: "int?",
    genre: "text?",
    videoId: "text?",
    addedAt: "int",
  },
  playlists: { name: "text", createdAt: "int" },
  playlistEntries: {
    playlistId: "text",
    orderKey: "text",
    songId: "text?",
    ytSong: "text?",
    removedAt: "int?",
    addedAt: "int",
    restoredAt: "int?",
    // not UI text: a wire field kind
    title: "text?",
    credit: "text?",
    album: "text?",
    durationMs: "int?",
    videoId: "text?",
    addedBy: "text?",
  },
  favorites: { addedAt: "int" },
  preferences: { value: "text?" },
  plays: {
    songId: "text",
    startedAt: "int",
    listenedMs: "int",
    durationMs: "int?",
    endReason: ["completed", "skipped", "stopped", "interrupted"],
    counted: "bool",
    contextType: "text?",
    contextId: "text?",
    contextPlaylistId: "text?",
    source: ["phone", "auto", "desktop"],
    importedFrom: ["blackplayer", null],
    snapshot: "snapshot?",
    videoId: "text?",
  },
  follows: {
    name: "text",
    level: ["releases", "shows"],
    followedAt: "int",
    deezerId: "int?",
    ytBrowseId: "text?",
  },
  hiddenReleases: {},
  notifiedShows: {},
  dismissedSuggestions: { dismissedAt: "int" },
  // not UI text: wire field kinds
  dislikes: { title: "text", artists: "text", durationMs: "int?", dislikedAt: "int" },
};

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Whether [value] is what a field of [kind] holds (`undefined` counts as null). */
export const syncFieldFits = (kind: SyncFieldKind, value: unknown): boolean => {
  if (typeof kind !== "string") return kind.includes(value as string | null);
  if (value === null || value === undefined) return kind.endsWith("?");
  switch (kind) {
    case "text":
    case "text?":
      return typeof value === "string";
    case "int":
    case "int?":
      return Number.isSafeInteger(value);
    case "bool":
      return typeof value === "boolean";
    case "snapshot?":
      return (
        isRecord(value) &&
        typeof value.title === "string" &&
        typeof value.artist === "string" &&
        (value.album === null || typeof value.album === "string") &&
        (value.artworkPath === null || typeof value.artworkPath === "string") &&
        (value.thumbPath === null || typeof value.thumbPath === "string")
      );
  }
};

/** [raw] as a row of [table] with only the fields it has, or null when it isn't one. */
const readRow = (table: keyof SyncTables, raw: unknown): object | null => {
  if (!isRecord(raw) || typeof raw.id !== "string" || raw.id === "") return null;
  const row: Record<string, unknown> = { id: raw.id };
  if (table !== "plays") {
    if (!Number.isSafeInteger(raw.changedAt) || typeof raw.phoneId !== "string") return null;
    if (typeof raw.deleted !== "boolean") return null;
    row.changedAt = raw.changedAt;
    row.phoneId = raw.phoneId;
    row.deleted = raw.deleted;
    if (raw.deleted && !(table === "playlistEntries" && Number.isSafeInteger(raw.removedAt)))
      return row;
  }
  for (const [name, kind] of Object.entries(SYNC_FIELDS[table])) {
    const value = raw[name] ?? null;
    if (!syncFieldFits(kind, value)) return null;
    row[name] = value;
  }
  return row;
};

/** One page of a pull: the rows changed after the cursor sent, and the next cursor. */
export interface SyncPullPage extends SyncTables {
  /** Opaque: sent back as is for the next pull. */
  readonly cursor: string;
  /** Whether more rows wait: pull again at once. */
  readonly more: boolean;
}

/**
 * Reads the body of a `GET /v1/pull` answer. A row that isn't one of its
 * table's, or a table it doesn't know, is left out, so one bad row can't
 * hold the rest back; an answer with no cursor isn't a page (null).
 */
export const readPullPage = (body: string): SyncPullPage | null => {
  let raw: unknown;
  try {
    raw = JSON.parse(body);
  } catch {
    return null;
  }
  if (!isRecord(raw) || typeof raw.cursor !== "string" || typeof raw.more !== "boolean") {
    return null;
  }
  const tables = Object.fromEntries(
    SYNC_TABLE_NAMES.map((table) => {
      const rows = raw[table];
      return [
        table,
        Array.isArray(rows) ? rows.flatMap((row: unknown) => readRow(table, row) ?? []) : [],
      ];
    }),
  ) as unknown as SyncTables;
  return { ...tables, cursor: raw.cursor, more: raw.more };
};

/** A pushed row the service stored with another change time than the one sent. */
export interface CorrectedChangeTime {
  readonly table: Exclude<keyof SyncTables, "plays">;
  readonly id: string;
  /** The change time the service holds for the row. */
  readonly changedAt: number;
}

/** What the app reads of a `POST /v1/push` answer. */
export interface SyncPushAnswer {
  /**
   * The rows stored with the service's time because theirs was ahead of its
   * clock (`withinServiceClock`), in table order: the app adopts each.
   */
  readonly corrected: readonly CorrectedChangeTime[];
}

/**
 * Reads the body of a `POST /v1/push` answer. A service from before it
 * corrected change times names none, and an entry that isn't a corrected
 * row, or a table it doesn't know, is left out.
 */
export const readPushAnswer = (body: string): SyncPushAnswer => {
  let raw: unknown;
  try {
    raw = JSON.parse(body);
  } catch {
    return { corrected: [] };
  }
  const tables = isRecord(raw) && isRecord(raw.corrected) ? raw.corrected : {};
  return {
    corrected: SYNC_TABLE_NAMES.flatMap((table) => {
      const rows = tables[table];
      if (table === "plays" || !Array.isArray(rows)) return [];
      return rows.flatMap((row: unknown) =>
        isRecord(row) && typeof row.id === "string" && Number.isSafeInteger(row.changedAt)
          ? [{ table, id: row.id, changedAt: row.changedAt as number }]
          : [],
      );
    }),
  };
};

/**
 * How big one push gets. The service takes bodies up to 2 MiB; a batch stays
 * well under it, and under a thousand rows, so the service merges each in a
 * few queries.
 */
export const SYNC_PUSH_BATCH = { maxBytes: 1_500_000, maxRows: 1_000 } as const;

/** The length of [text] in UTF-8, as a request body counts it. */
const utf8Length = (text: string): number => {
  let bytes = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff) {
      // A surrogate pair: one 4-byte character.
      bytes += 4;
      i++;
    } else bytes += 3;
  }
  return bytes;
};

/** The bytes of a batch with no rows: `{"songs":[],…}`. */
const ENVELOPE = utf8Length(JSON.stringify(EMPTY_SYNC_TABLES));

/**
 * Cuts [changes] into pushes the service takes in one request each (each
 * under `SYNC_PUSH_BATCH`), every row once, in table order (`SYNC_TABLE_NAMES`) and
 * in the order given. Nothing to push is no push.
 */
export const pushBatches = (
  changes: SyncTables,
  limits: { readonly maxBytes: number; readonly maxRows: number } = SYNC_PUSH_BATCH,
): SyncTables[] => {
  const batches: SyncTables[] = [];
  let open: { [K in keyof SyncTables]: SyncTables[K][number][] } | null = null;
  let bytes = 0;
  let rows = 0;
  for (const table of SYNC_TABLE_NAMES) {
    for (const row of changes[table]) {
      // The row and the comma before it.
      const size = utf8Length(JSON.stringify(row)) + 1;
      if (open === null || rows >= limits.maxRows || bytes + size > limits.maxBytes) {
        open = Object.fromEntries(SYNC_TABLE_NAMES.map((name) => [name, []])) as unknown as {
          [K in keyof SyncTables]: SyncTables[K][number][];
        };
        batches.push(open);
        bytes = ENVELOPE;
        rows = 0;
      }
      (open[table] as unknown[]).push(row);
      bytes += size;
      rows += 1;
    }
  }
  return batches;
};

/**
 * [batch] as a push's body: only the tables it has rows of, so a service
 * from before a table was added still takes a push that has none.
 */
export const pushBody = (batch: SyncTables): string =>
  JSON.stringify(
    Object.fromEntries(
      SYNC_TABLE_NAMES.flatMap((name) => (batch[name].length > 0 ? [[name, batch[name]]] : [])),
    ),
  );
