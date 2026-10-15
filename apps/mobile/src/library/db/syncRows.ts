/**
 * The Library store's side of syncing with the Wave account (docs/spec.md,
 * "Wave account and sync"): which account the Library is joined with, the
 * rows changed here that wait to go up (as the service's rows, local ids
 * translated to recording keys and sync ids), and the rows that come down
 * applied by Core's merge rules (recording keys translated to the phone's
 * Tracks). Rows it can't place yet wait in `sync_pending`. Kept free of Expo
 * so the store tests run it against a real SQLite (`testDatabase.ts`).
 */
import {
  UNKNOWN_ALBUM,
  accountTrackIds,
  mergeRows,
  planSongSync,
  type AccountSongState,
  type PhoneSong,
  type SyncFavorite,
  type SyncPlayRow,
  type SyncPlaylist,
  type SyncPlaylistEntry,
  type SyncPreference,
  type SyncPullPage,
  type SyncRow,
  type SyncSong,
  type SyncSongFields,
  type SyncTables,
} from "@wave/core";
import { and, asc, eq, inArray, isNotNull, isNull, or, sql } from "drizzle-orm";

import { chunks } from "./chunks.ts";
import type { LibraryDatabase } from "./database.ts";
import * as schema from "./schema.ts";
import { selectPhoneId, selectTrackIdentities } from "./sync.ts";
import { hasFile } from "./tracks.ts";

// --- The account the Library is joined with ---------------------------------

const state = (db: LibraryDatabase) =>
  db.select().from(schema.syncState).where(eq(schema.syncState.id, 1)).get() ?? {
    account: null,
    cursor: null,
  };

/**
 * Joins the Library with [account] unless it's joined with it already;
 * true when it joined anew (the first sign-in, a sign-in after signing out,
 * or another account). Joining starts from nothing on the account's side
 * (the whole account is pulled again, what the phone knew of another
 * account's songs goes) and sends every playlist, entry, star, preference
 * and play up again: the two Libraries are joined, never replaced.
 */
export const joinAccount = (db: LibraryDatabase, account: string): boolean => {
  if (state(db).account === account) return false;
  const { syncState, playlists, playlistItems, favorites, preferenceChanges, playEvents } = schema;
  db.transaction((tx) => {
    tx.insert(syncState)
      .values({ id: 1, account, cursor: null })
      .onConflictDoUpdate({ target: syncState.id, set: { account, cursor: null } })
      .run();
    for (const table of [playlists, playlistItems, favorites, preferenceChanges, playEvents]) {
      tx.update(table).set({ pushed: false }).where(eq(table.pushed, true)).run();
    }
    tx.delete(schema.accountSongs).run();
    tx.delete(schema.syncPending).run();
  });
  return true;
};

/** Leaves the account (signed out): the next sign-in joins anew. The Library stays as it is. */
export const leaveAccount = (db: LibraryDatabase): void => {
  db.update(schema.syncState).set({ account: null, cursor: null }).run();
};

/** The account the Library is joined with, if any. */
export const selectJoinedAccount = (db: LibraryDatabase): string | null => state(db).account;

/** The cursor of the last page pulled (null: pull everything). */
export const selectSyncCursor = (db: LibraryDatabase): string | null => state(db).cursor;

// --- Translating keys to Tracks ----------------------------------------------

/**
 * Which of the phone's Tracks each recording key is (Core's
 * `accountTrackIds`): the account song's length breaks a tie between Tracks
 * with one key.
 */
export const selectAccountTrackIds = (db: LibraryDatabase): Map<string, number> => {
  const tracks = selectTrackIdentities(db);
  const seen = new Set<string>();
  const shared = new Set<string>();
  for (const track of tracks) {
    if (track.recordingKey === null) continue;
    if (seen.has(track.recordingKey)) shared.add(track.recordingKey);
    seen.add(track.recordingKey);
  }
  const { accountSongs } = schema;
  const lengths = chunks([...shared]).flatMap((keys) =>
    db
      .select({
        recordingKey: accountSongs.recordingKey,
        durationMs: sql<number>`json_extract(${accountSongs.song}, '$.durationMs')`,
      })
      .from(accountSongs)
      .where(and(inArray(accountSongs.recordingKey, keys), isNotNull(accountSongs.song)))
      .all(),
  );
  return accountTrackIds(tracks, lengths);
};

// --- What goes up ------------------------------------------------------------

/** A local row a pushed row was read from, and the change it had then. */
type PushMark =
  | { readonly table: "songs"; readonly key: string; readonly changedAt: number }
  | { readonly table: "playlists" | "entries"; readonly id: number; readonly changedAt: number }
  | { readonly table: "favorites"; readonly trackId: number; readonly changedAt: number }
  | { readonly table: "preferences"; readonly key: string; readonly changedAt: number }
  | { readonly table: "plays"; readonly id: number };

/** Rows that wait to go up, as the service takes them, and where each came from. */
export interface UnpushedRows {
  readonly rows: SyncTables;
  /** The local rows behind each pushed row, by `<table>:<id>` (`markPushed` takes them). */
  readonly marks: ReadonlyMap<string, readonly PushMark[]>;
}

/** The key `UnpushedRows.marks` files a pushed row under. */
export const pushMarkKey = (table: keyof SyncTables, id: string): string => `${table}:${id}`;

const stamp = (row: {
  readonly changedAt: number;
  readonly phoneId: string;
  readonly deleted: boolean;
}) => ({ changedAt: row.changedAt, phoneId: row.phoneId, deleted: row.deleted });

/** A song's fields as stored in `account_songs`, or null for a tombstone. */
const storedSong = (row: SyncSong): string | null => {
  if (row.deleted) return null;
  const { id: _id, changedAt: _at, phoneId: _phone, deleted: _deleted, ...fields } = row;
  return JSON.stringify(fields);
};

const songRow = (row: {
  readonly recordingKey: string;
  readonly song: string | null;
  readonly changedAt: number;
  readonly phoneId: string;
  readonly deleted: boolean;
}): SyncSong =>
  row.deleted || row.song === null
    ? { id: row.recordingKey, ...stamp(row), deleted: true }
    : {
        id: row.recordingKey,
        ...stamp(row),
        deleted: false,
        ...(JSON.parse(row.song) as SyncSongFields),
      };

/**
 * Up to [limit] rows of each table that changed here and aren't on the
 * account yet, as the service's rows: songs by recording key, entries,
 * stars and plays pointing at recording keys, preferences with the value
 * [preferenceValue] gives. A star of two Tracks with one key goes up once,
 * the later change. The play going on now waits until it ends.
 */
export const selectUnpushed = (
  db: LibraryDatabase,
  limit: number,
  preferenceValue: (key: string) => string | null,
): UnpushedRows => {
  const { accountSongs, playlists, playlistItems, favorites, tracks, preferenceChanges } = schema;
  const { playEvents } = schema;
  const marks = new Map<string, PushMark[]>();
  const mark = (table: keyof SyncTables, id: string, from: PushMark) => {
    const key = pushMarkKey(table, id);
    const held = marks.get(key);
    if (held === undefined) marks.set(key, [from]);
    else held.push(from);
  };

  const songs = db
    .select()
    .from(accountSongs)
    .where(eq(accountSongs.pushed, false))
    .orderBy(asc(accountSongs.recordingKey))
    .limit(limit)
    .all()
    .map((row) => {
      mark("songs", row.recordingKey, {
        table: "songs",
        key: row.recordingKey,
        changedAt: row.changedAt,
      });
      return songRow(row);
    });

  const playlistRows = db
    .select()
    .from(playlists)
    .where(eq(playlists.pushed, false))
    .orderBy(asc(playlists.id))
    .limit(limit)
    .all()
    .map((row): SyncPlaylist => {
      mark("playlists", row.syncId, { table: "playlists", id: row.id, changedAt: row.changedAt });
      return row.deleted
        ? { id: row.syncId, ...stamp(row), deleted: true }
        : {
            id: row.syncId,
            ...stamp(row),
            deleted: false,
            name: row.name,
            createdAt: row.createdAt,
          };
    });

  const entries = db
    .select({
      id: playlistItems.id,
      syncId: playlistItems.syncId,
      playlistId: playlists.syncId,
      orderKey: playlistItems.orderKey,
      songId: tracks.recordingKey,
      ytSong: playlistItems.ytSong,
      addedAt: playlistItems.addedAt,
      changedAt: playlistItems.changedAt,
      phoneId: playlistItems.phoneId,
      deleted: playlistItems.deleted,
    })
    .from(playlistItems)
    .innerJoin(playlists, eq(playlistItems.playlistId, playlists.id))
    .leftJoin(tracks, eq(playlistItems.trackId, tracks.id))
    .where(
      and(
        eq(playlistItems.pushed, false),
        // A Track not keyed yet can't be named to the account: its entry waits.
        or(isNull(playlistItems.trackId), isNotNull(tracks.recordingKey)),
      ),
    )
    .orderBy(asc(playlistItems.id))
    .limit(limit)
    .all()
    .map((row): SyncPlaylistEntry => {
      mark("playlistEntries", row.syncId, {
        table: "entries",
        id: row.id,
        changedAt: row.changedAt,
      });
      return row.deleted
        ? { id: row.syncId, ...stamp(row), deleted: true }
        : {
            id: row.syncId,
            ...stamp(row),
            deleted: false,
            playlistId: row.playlistId,
            orderKey: row.orderKey,
            songId: row.songId,
            ytSong: row.songId === null ? row.ytSong : null,
            addedAt: row.addedAt,
          };
    });

  const stars = db
    .select({
      trackId: favorites.trackId,
      recordingKey: sql<string>`${tracks.recordingKey}`,
      addedAt: favorites.addedAt,
      changedAt: favorites.changedAt,
      phoneId: favorites.phoneId,
      deleted: favorites.deleted,
    })
    .from(favorites)
    .innerJoin(tracks, eq(favorites.trackId, tracks.id))
    .where(and(eq(favorites.pushed, false), isNotNull(tracks.recordingKey)))
    .orderBy(asc(favorites.trackId))
    .limit(limit)
    .all()
    .map((row): SyncFavorite => {
      mark("favorites", row.recordingKey, {
        table: "favorites",
        trackId: row.trackId,
        changedAt: row.changedAt,
      });
      return row.deleted
        ? { id: row.recordingKey, ...stamp(row), deleted: true }
        : { id: row.recordingKey, ...stamp(row), deleted: false, addedAt: row.addedAt };
    });

  const preferences = db
    .select()
    .from(preferenceChanges)
    .where(eq(preferenceChanges.pushed, false))
    .orderBy(asc(preferenceChanges.key))
    .limit(limit)
    .all()
    .map((row): SyncPreference => {
      mark("preferences", row.key, {
        table: "preferences",
        key: row.key,
        changedAt: row.changedAt,
      });
      return {
        id: row.key,
        changedAt: row.changedAt,
        phoneId: row.phoneId,
        deleted: false,
        value: preferenceValue(row.key),
      };
    });

  const plays = db
    .select()
    .from(playEvents)
    .where(
      and(
        eq(playEvents.pushed, false),
        eq(playEvents.ongoing, false),
        isNotNull(playEvents.syncId),
        isNotNull(playEvents.recordingKey),
      ),
    )
    .orderBy(asc(playEvents.id))
    .limit(limit)
    .all()
    .flatMap((row): SyncPlayRow[] => {
      if (row.syncId === null || row.recordingKey === null) return [];
      mark("plays", row.syncId, { table: "plays", id: row.id });
      return [
        {
          id: row.syncId,
          songId: row.recordingKey,
          startedAt: row.startedAt,
          listenedMs: row.listenedMs,
          durationMs: row.durationMs,
          endReason: row.endReason,
          counted: row.counted,
          contextType: row.contextType,
          contextId: row.contextId,
          source: row.source,
          importedFrom: row.importedFrom,
        },
      ];
    });

  return {
    rows: {
      songs,
      playlists: playlistRows,
      playlistEntries: entries,
      // Two Tracks with one key are one song for the account: one star, the later change.
      favorites: mergeRows([], stars).rows,
      preferences,
      plays,
    },
    marks,
  };
};

/**
 * Records that the account has the changes behind [marks] (`selectUnpushed`).
 * A row changed again since it was read keeps waiting.
 */
export const markPushed = (db: LibraryDatabase, marks: readonly PushMark[]): void => {
  const { accountSongs, playlists, playlistItems, favorites, preferenceChanges, playEvents } =
    schema;
  db.transaction((tx) => {
    const plays: number[] = [];
    for (const from of marks) {
      switch (from.table) {
        case "songs":
          tx.update(accountSongs)
            .set({ pushed: true })
            .where(
              and(
                eq(accountSongs.recordingKey, from.key),
                eq(accountSongs.changedAt, from.changedAt),
              ),
            )
            .run();
          break;
        case "playlists":
          tx.update(playlists)
            .set({ pushed: true })
            .where(and(eq(playlists.id, from.id), eq(playlists.changedAt, from.changedAt)))
            .run();
          break;
        case "entries":
          tx.update(playlistItems)
            .set({ pushed: true })
            .where(and(eq(playlistItems.id, from.id), eq(playlistItems.changedAt, from.changedAt)))
            .run();
          break;
        case "favorites":
          tx.update(favorites)
            .set({ pushed: true })
            .where(
              and(eq(favorites.trackId, from.trackId), eq(favorites.changedAt, from.changedAt)),
            )
            .run();
          break;
        case "preferences":
          tx.update(preferenceChanges)
            .set({ pushed: true })
            .where(
              and(
                eq(preferenceChanges.key, from.key),
                eq(preferenceChanges.changedAt, from.changedAt),
              ),
            )
            .run();
          break;
        case "plays":
          plays.push(from.id);
          break;
      }
    }
    for (const ids of chunks(plays)) {
      tx.update(playEvents).set({ pushed: true }).where(inArray(playEvents.id, ids)).run();
    }
  });
};

// --- The song list -------------------------------------------------------------

/** The phone's songs as the account would hold them: every Track with a file and a key, by id. */
const selectPhoneSongs = (db: LibraryDatabase): PhoneSong[] => {
  const { tracks, albums, genres } = schema;
  return db
    .select({
      recordingKey: sql<string>`${tracks.recordingKey}`,
      title: tracks.title,
      credit: tracks.artistCredit,
      album: albums.title,
      albumArtist: albums.albumArtistCredit,
      discNumber: tracks.discNumber,
      trackNumber: tracks.trackNumber,
      durationMs: tracks.durationMs,
      year: tracks.year,
      genre: genres.name,
      videoId: tracks.videoId,
      addedAt: tracks.addedAt,
    })
    .from(tracks)
    .innerJoin(albums, eq(tracks.albumId, albums.id))
    .leftJoin(genres, eq(tracks.genreId, genres.id))
    .where(and(hasFile, isNotNull(tracks.recordingKey)))
    .orderBy(asc(tracks.id))
    .all()
    .map(({ recordingKey, ...fields }) => ({
      recordingKey,
      fields: { ...fields, album: fields.album === UNKNOWN_ALBUM ? null : fields.album },
    }));
};

/**
 * Brings the account's song list up to date with the phone's (Core's
 * `planSongSync`): the songs it lacks, and those retagged here, wait to go
 * up as of [now].
 */
export const planSongs = (db: LibraryDatabase, now: number): void => {
  const { accountSongs } = schema;
  const account: AccountSongState[] = db
    .select()
    .from(accountSongs)
    .all()
    .map((row) => ({ row: songRow(row), local: row.local }));
  const plan = planSongSync({
    phone: selectPhoneSongs(db),
    account,
    now,
    phoneId: selectPhoneId(db),
  });
  if (plan.push.length === 0 && plan.local.length === 0) return;
  const local = new Map(plan.local.map((entry) => [entry.recordingKey, entry.local]));
  db.transaction((tx) => {
    for (const row of plan.push) {
      const values = {
        song: storedSong(row),
        ...stamp(row),
        pushed: false,
        local: local.get(row.id) ?? null,
      };
      tx.insert(accountSongs)
        .values({ recordingKey: row.id, ...values })
        .onConflictDoUpdate({ target: accountSongs.recordingKey, set: values })
        .run();
      local.delete(row.id);
    }
    for (const [recordingKey, text] of local) {
      tx.update(accountSongs)
        .set({ local: text })
        .where(eq(accountSongs.recordingKey, recordingKey))
        .run();
    }
  });
};

// --- What comes down -----------------------------------------------------------

/** What applying rows from the account changed on the phone. */
export interface PulledChanges {
  readonly songs: boolean;
  readonly playlists: boolean;
  readonly favorites: boolean;
  readonly plays: boolean;
  /** The synced preferences whose value changed, with the value (null: none, its default). */
  readonly preferences: readonly { readonly key: string; readonly value: string | null }[];
}

interface Changed {
  songs: boolean;
  playlists: boolean;
  favorites: boolean;
  plays: boolean;
  preferences: { key: string; value: string | null }[];
}

const nothingChanged = (): Changed => ({
  songs: false,
  playlists: false,
  favorites: false,
  plays: false,
  preferences: [],
});

/** Whether change [row] wins over the [held] change of the same row (Core's `mergeRows`). */
const wins = (row: SyncRow, held: Omit<SyncRow, "id"> | undefined): boolean =>
  held === undefined || mergeRows([{ ...held, id: row.id }], [row]).accepted.length > 0;

type PendingKind = "playlistEntries" | "favorites" | "plays";

const pendingRow = (tx: LibraryDatabase, kind: PendingKind, id: string) => {
  const { syncPending } = schema;
  const held = tx
    .select({ row: syncPending.row })
    .from(syncPending)
    .where(and(eq(syncPending.kind, kind), eq(syncPending.id, id)))
    .get();
  return held === undefined ? undefined : (JSON.parse(held.row) as SyncRow);
};

const unpend = (tx: LibraryDatabase, kind: PendingKind, id: string): void => {
  const { syncPending } = schema;
  tx.delete(syncPending)
    .where(and(eq(syncPending.kind, kind), eq(syncPending.id, id)))
    .run();
};

/** Keeps [row] until the song ([songKey]) or playlist ([playlistKey]) it needs is on the phone. */
const pend = (
  tx: LibraryDatabase,
  kind: PendingKind,
  row: { readonly id: string },
  waitsFor: { readonly songKey?: string | null; readonly playlistKey?: string | null },
): void => {
  const { syncPending } = schema;
  const values = {
    songKey: waitsFor.songKey ?? null,
    playlistKey: waitsFor.playlistKey ?? null,
    row: JSON.stringify(row),
  };
  tx.insert(syncPending)
    .values({ kind, id: row.id, ...values })
    .onConflictDoUpdate({ target: [syncPending.kind, syncPending.id], set: values })
    .run();
};

/**
 * Whether [row] is newer than any change of it waiting in `sync_pending`;
 * a waiting change it beats is dropped.
 */
const beatsPending = (tx: LibraryDatabase, kind: PendingKind, row: SyncRow): boolean => {
  const waiting = pendingRow(tx, kind, row.id);
  if (waiting === undefined) return true;
  if (!wins(row, waiting)) return false;
  unpend(tx, kind, row.id);
  return true;
};

const applySong = (tx: LibraryDatabase, row: SyncSong): boolean => {
  const { accountSongs } = schema;
  const held = tx.select().from(accountSongs).where(eq(accountSongs.recordingKey, row.id)).get();
  if (held !== undefined && !wins(row, held)) return false;
  const values = { song: storedSong(row), ...stamp(row), pushed: true };
  tx.insert(accountSongs)
    .values({ recordingKey: row.id, ...values })
    .onConflictDoUpdate({ target: accountSongs.recordingKey, set: values })
    .run();
  return true;
};

const applyPlaylist = (tx: LibraryDatabase, row: SyncPlaylist, now: number): boolean => {
  const { playlists } = schema;
  const held = tx.select().from(playlists).where(eq(playlists.syncId, row.id)).get();
  if (held !== undefined && !wins(row, held)) return false;
  const live = row.deleted ? {} : { name: row.name };
  if (held !== undefined) {
    tx.update(playlists)
      .set({ ...live, ...stamp(row), pushed: true, updatedAt: now })
      .where(eq(playlists.id, held.id))
      .run();
  } else {
    tx.insert(playlists)
      .values({
        syncId: row.id,
        name: row.deleted ? "" : row.name,
        createdAt: row.deleted ? row.changedAt : row.createdAt,
        updatedAt: now,
        ...stamp(row),
        pushed: true,
      })
      .run();
  }
  return true;
};

const applyEntry = (
  tx: LibraryDatabase,
  row: SyncPlaylistEntry,
  trackIds: ReadonlyMap<string, number>,
): boolean => {
  const { playlists, playlistItems } = schema;
  if (!beatsPending(tx, "playlistEntries", row)) return false;
  const held = tx.select().from(playlistItems).where(eq(playlistItems.syncId, row.id)).get();
  if (held !== undefined && !wins(row, held)) return false;
  if (row.deleted) {
    if (held === undefined) return false;
    tx.update(playlistItems)
      .set({ ...stamp(row), pushed: true })
      .where(eq(playlistItems.id, held.id))
      .run();
    return true;
  }
  const playlist = tx
    .select({ id: playlists.id })
    .from(playlists)
    .where(eq(playlists.syncId, row.playlistId))
    .get();
  const trackId = row.songId === null ? null : trackIds.get(row.songId);
  if (playlist === undefined || trackId === undefined) {
    pend(tx, "playlistEntries", row, {
      songKey: trackId === undefined ? row.songId : null,
      playlistKey: playlist === undefined ? row.playlistId : null,
    });
    return false;
  }
  const values = {
    playlistId: playlist.id,
    trackId,
    ytSong: trackId === null ? row.ytSong : null,
    orderKey: row.orderKey,
    addedAt: row.addedAt,
    ...stamp(row),
    pushed: true,
  };
  if (held !== undefined) {
    tx.update(playlistItems).set(values).where(eq(playlistItems.id, held.id)).run();
  } else {
    tx.insert(playlistItems)
      .values({ syncId: row.id, ...values })
      .run();
  }
  return true;
};

const applyFavorite = (
  tx: LibraryDatabase,
  row: SyncFavorite,
  trackIds: ReadonlyMap<string, number>,
): boolean => {
  const { favorites } = schema;
  if (!beatsPending(tx, "favorites", row)) return false;
  const trackId = trackIds.get(row.id);
  if (trackId === undefined) {
    pend(tx, "favorites", row, { songKey: row.id });
    return false;
  }
  const held = tx.select().from(favorites).where(eq(favorites.trackId, trackId)).get();
  if (held !== undefined && !wins(row, held)) return false;
  const live = row.deleted ? {} : { addedAt: row.addedAt };
  if (held !== undefined) {
    tx.update(favorites)
      .set({ ...live, ...stamp(row), pushed: true })
      .where(eq(favorites.trackId, trackId))
      .run();
  } else {
    tx.insert(favorites)
      .values({
        trackId,
        addedAt: row.deleted ? row.changedAt : row.addedAt,
        ...stamp(row),
        pushed: true,
      })
      .run();
  }
  return true;
};

const applyPreference = (
  tx: LibraryDatabase,
  row: SyncPreference,
): { key: string; value: string | null } | null => {
  const { preferenceChanges } = schema;
  const held = tx.select().from(preferenceChanges).where(eq(preferenceChanges.key, row.id)).get();
  if (held !== undefined && !wins(row, { ...held, deleted: false })) return null;
  const values = { changedAt: row.changedAt, phoneId: row.phoneId, pushed: true };
  tx.insert(preferenceChanges)
    .values({ key: row.id, ...values })
    .onConflictDoUpdate({ target: preferenceChanges.key, set: values })
    .run();
  return { key: row.id, value: row.deleted ? null : row.value };
};

const applyPlay = (
  tx: LibraryDatabase,
  row: SyncPlayRow,
  trackIds: ReadonlyMap<string, number>,
): boolean => {
  const { playEvents } = schema;
  const held = tx
    .select({ id: playEvents.id })
    .from(playEvents)
    .where(eq(playEvents.syncId, row.id))
    .get();
  if (held !== undefined) {
    // The account has it already (another phone imported the same stats): it needn't go up.
    tx.update(playEvents).set({ pushed: true }).where(eq(playEvents.id, held.id)).run();
    unpend(tx, "plays", row.id);
    return false;
  }
  const trackId = trackIds.get(row.songId);
  if (trackId === undefined) {
    pend(tx, "plays", row, { songKey: row.songId });
    return false;
  }
  unpend(tx, "plays", row.id);
  tx.insert(playEvents)
    .values({
      trackId,
      recordingKey: row.songId,
      syncId: row.id,
      startedAt: row.startedAt,
      listenedMs: row.listenedMs,
      durationMs: row.durationMs,
      endReason: row.endReason,
      counted: row.counted,
      contextType: row.contextType,
      contextId: row.contextId,
      source: row.source,
      importedFrom: row.importedFrom,
      ongoing: false,
      pushed: true,
    })
    .run();
  return true;
};

const applyRows = (
  tx: LibraryDatabase,
  rows: Pick<SyncTables, "playlistEntries" | "favorites" | "plays">,
  trackIds: ReadonlyMap<string, number>,
  changed: Changed,
): void => {
  for (const row of rows.playlistEntries) {
    if (applyEntry(tx, row, trackIds)) changed.playlists = true;
  }
  for (const row of rows.favorites) {
    if (applyFavorite(tx, row, trackIds)) changed.favorites = true;
  }
  for (const row of rows.plays) {
    if (applyPlay(tx, row, trackIds)) changed.plays = true;
  }
};

/**
 * Applies a page the account sent: each row merged with the phone's by
 * Core's rules (`mergeRows`, plays by id only), recording keys turned into
 * the phone's Tracks by [trackIds] (`selectAccountTrackIds`). A row whose
 * song or playlist the phone lacks waits in `sync_pending`. The page's
 * cursor is kept for the next pull, in the same transaction.
 */
export const applyPulledPage = (
  db: LibraryDatabase,
  page: SyncPullPage,
  trackIds: ReadonlyMap<string, number>,
  now: number,
): PulledChanges =>
  db.transaction((tx) => {
    const changed = nothingChanged();
    for (const row of page.songs) {
      if (applySong(tx, row)) changed.songs = true;
    }
    for (const row of page.playlists) {
      if (applyPlaylist(tx, row, now)) changed.playlists = true;
    }
    applyRows(tx, page, trackIds, changed);
    for (const row of page.preferences) {
      const applied = applyPreference(tx, row);
      if (applied !== null) changed.preferences.push(applied);
    }
    tx.update(schema.syncState)
      .set({ cursor: page.cursor })
      .where(eq(schema.syncState.id, 1))
      .run();
    return changed;
  });

/**
 * Applies the rows waiting in `sync_pending` whose song and playlist the
 * phone now has (a scan found the file, the playlist came in a later page).
 */
export const applyPending = (
  db: LibraryDatabase,
  trackIds: ReadonlyMap<string, number>,
): PulledChanges => {
  const { syncPending, tracks, playlists } = schema;
  return db.transaction((tx) => {
    const ready = tx
      .select()
      .from(syncPending)
      .where(
        and(
          or(
            isNull(syncPending.songKey),
            inArray(syncPending.songKey, tx.select({ key: tracks.recordingKey }).from(tracks)),
          ),
          or(
            isNull(syncPending.playlistKey),
            inArray(syncPending.playlistKey, tx.select({ key: playlists.syncId }).from(playlists)),
          ),
        ),
      )
      .all();
    const rows = {
      playlistEntries: [] as SyncPlaylistEntry[],
      favorites: [] as SyncFavorite[],
      plays: [] as SyncPlayRow[],
    };
    for (const row of ready) {
      unpend(tx, row.kind as PendingKind, row.id);
      (rows[row.kind as PendingKind] as unknown[]).push(JSON.parse(row.row));
    }
    const changed = nothingChanged();
    applyRows(tx, rows, trackIds, changed);
    return changed;
  });
};
