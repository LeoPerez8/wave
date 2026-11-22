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
  EMPTY_SYNC_TABLES,
  UNKNOWN_ALBUM,
  finishSteps,
  accountTrackIds,
  collaborativeEntryMatcher,
  creditSplitter,
  creditSplitterSteps,
  pullPagePieces,
  libraryEntryFields,
  writePlaylistEntrySong as writeEntrySong,
  type CollaborativeEntryMatch,
  type CollaborativeLibraryEntry,
  type EntryTrack,
  duplicatePlaylistEntries,
  leavingSongEntry,
  mergePlaylistEntries,
  mergeRows,
  parseTrackId,
  planSongSync,
  playlistEntrySong,
  recordingMatchTitle,
  settleMarks,
  songsLeaving,
  syncsPreference,
  type AccountSongState,
  type PhoneSong,
  type SyncDislike,
  type SyncDismissedSuggestion,
  type SyncFavorite,
  type SyncFollow,
  type SyncPlayRow,
  type SyncPlaylist,
  type SyncPlaylistEntry,
  type SyncPreference,
  type PlaySnapshot,
  type SyncPullPage,
  type SyncEntryRow,
  type SyncRow,
  type SyncSong,
  type SyncSongFields,
  type SyncTables,
  UNKNOWN_SONG_TITLE,
  writePlaylistEntrySong,
} from "@wave/core";
import {
  and,
  asc,
  eq,
  getTableColumns,
  gt,
  inArray,
  isNotNull,
  isNull,
  like,
  notLike,
  or,
  sql,
  type SQL,
} from "drizzle-orm";

import { chunks } from "./chunks.ts";
import { dropMemberPlaylists } from "./collaborations.ts";
import type { LibraryDatabase } from "./database.ts";
import { leavingSong, leavingSongColumns } from "./leavingSong.ts";
import * as schema from "./schema.ts";
import { selectPhoneId, selectTrackIdentities, stamped } from "./sync.ts";
import { hasFile, trackQuery } from "./tracks.ts";

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
 * play, follow, hidden release, notified show, dismissed follow
 * suggestion and dislike up again: the two Libraries are joined, never replaced.
 */
export const joinAccount = (db: LibraryDatabase, account: string): boolean => {
  if (state(db).account === account) return false;
  const { syncState, playlists, playlistItems, favorites, preferenceChanges, playEvents } = schema;
  const { follows, hiddenFollowReleases, notifiedFollowShows, dismissedFollowSuggestions } = schema;
  db.transaction((tx) => {
    // Another account's collaborative playlists aren't this one's to join.
    dropMemberPlaylists(tx);
    tx.insert(syncState)
      .values({ id: 1, account, cursor: null })
      .onConflictDoUpdate({ target: syncState.id, set: { account, cursor: null } })
      .run();
    for (const table of [
      playlists,
      playlistItems,
      favorites,
      preferenceChanges,
      playEvents,
      follows,
      hiddenFollowReleases,
      notifiedFollowShows,
      dismissedFollowSuggestions,
      schema.dislikes,
    ]) {
      tx.update(table).set({ pushed: false }).where(eq(table.pushed, true)).run();
    }
    tx.delete(schema.accountSongs).run();
    tx.delete(schema.syncPending).run();
    tx.delete(schema.syncRemovals).run();
  });
  return true;
};

/**
 * Leaves the account (signed out): the next sign-in joins anew. The Library stays as it is,
 * but for the collaborative playlists the account doesn't own, which the next sign-in's
 * pull brings back.
 */
export const leaveAccount = (db: LibraryDatabase): void => {
  db.transaction((tx) => {
    dropMemberPlaylists(tx);
    tx.update(schema.syncState).set({ account: null, cursor: null }).run();
  });
};

/** The account the Library is joined with, if any. */
export const selectJoinedAccount = (db: LibraryDatabase): string | null => state(db).account;

/** The cursor of the last page pulled (null: pull everything). */
export const selectSyncCursor = (db: LibraryDatabase): string | null => state(db).cursor;

// --- Translating keys to Tracks ----------------------------------------------

/**
 * Which of the phone's Tracks each recording key is (Core's
 * `accountTrackIds`): the account song's length breaks a tie between Tracks
 * with one key. Given [keys], it reads only the Tracks with those keys.
 */
export const selectAccountTrackIds = (
  db: LibraryDatabase,
  keys?: readonly string[],
): Map<string, number> => {
  const tracks = keys === undefined ? selectTrackIdentities(db) : selectKeyedTracks(db, keys);
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

/** The Tracks with the recording keys [keys], as `selectTrackIdentities` reads them. */
const selectKeyedTracks = (db: LibraryDatabase, keys: readonly string[]) => {
  const { tracks } = schema;
  return (
    chunks([...new Set(keys)])
      .flatMap((some) =>
        db
          .select({
            id: tracks.id,
            recordingKey: tracks.recordingKey,
            durationMs: tracks.durationMs,
          })
          .from(tracks)
          .where(inArray(tracks.recordingKey, some))
          .all(),
      )
      // oxlint-disable-next-line unicorn/no-array-sort -- sorts a fresh array; Hermes lacks toSorted
      .sort((a, b) => a.id - b.id)
  );
};

// --- What goes up ------------------------------------------------------------

// Covers are caches on each phone. Only remote references travel to the account.
const remoteCover = (value: string | null | undefined): string | null =>
  value !== null && value !== undefined && /^https?:\/\//i.test(value) ? value : null;

const wireSnapshot = (snapshot: PlaySnapshot | null): PlaySnapshot | null =>
  snapshot === null
    ? null
    : {
        title: snapshot.title,
        artist: snapshot.artist,
        album: snapshot.album,
        artworkPath: remoteCover(snapshot.artworkUrl) ?? remoteCover(snapshot.artworkPath),
        thumbPath: remoteCover(snapshot.thumbPath) ?? remoteCover(snapshot.artworkUrl),
      };

/** A local row a pushed row was read from, and the change it had then. */
export type PushMark =
  | { readonly table: "songs"; readonly key: string; readonly changedAt: number }
  | { readonly table: "playlists" | "entries"; readonly id: number; readonly changedAt: number }
  | { readonly table: "favorites"; readonly trackId: number; readonly changedAt: number }
  | {
      readonly table:
        | "preferences"
        | "follows"
        | "hiddenReleases"
        | "notifiedShows"
        | "dismissedSuggestions"
        | "dislikes";
      readonly key: string;
      readonly changedAt: number;
    }
  | { readonly table: "plays"; readonly id: number }
  | {
      readonly table: "removals";
      readonly kind: RemovalKind;
      readonly id: string;
      readonly changedAt: number;
    };

/** The tables whose removals can outlive their rows (`sync_removals`). */
type RemovalKind = "favorites" | "playlistEntries";

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
 * What an entry of a Track whose song the account removed (Remove from
 * Library, Delete on another phone) goes up as: the entry a song leaving the
 * Library becomes (Core's `leavingSongEntry`), as `yt_song` stores it, so
 * the other phones keep it in place instead of waiting for a song that
 * won't come. This phone keeps its file's song there. Null for any other
 * entry, which goes up as it is.
 */
const leftSong = (row: {
  readonly songId: string | null;
  readonly songGone: boolean | null;
  readonly videoId: string | null;
  readonly title: string | null;
  readonly artist: string | null;
  readonly artists: string | null;
  readonly album: string | null;
  readonly durationMs: number | null;
  readonly explicit: string | null;
}): string | null => {
  if (row.songId === null || row.songGone !== true || row.title === null || row.artist === null)
    return null;
  return writePlaylistEntrySong(
    leavingSongEntry(leavingSong({ ...row, title: row.title, artist: row.artist })),
  );
};

/** Files a pushed row under its table and id (`UnpushedRows.marks`). */
type Mark = (table: keyof SyncTables, id: string, from: PushMark) => void;

const marker = () => {
  const marks = new Map<string, PushMark[]>();
  const mark: Mark = (table, id, from) => {
    const key = pushMarkKey(table, id);
    const held = marks.get(key);
    if (held === undefined) marks.set(key, [from]);
    else held.push(from);
  };
  return { marks, mark };
};

/**
 * Whether the playlist [syncId] names isn't a collaborative playlist of another account:
 * those sync through the collaboration routes (`selectUnpushedPlaylist`), never the
 * account's own push.
 */
const notMemberPlaylist = (syncId: typeof schema.playlists.syncId) =>
  sql`${syncId} NOT IN (SELECT ${schema.collaborations.playlistSyncId} FROM ${schema.collaborations}
    WHERE ${schema.collaborations.owned} = 0)`;

const playlistRow = (row: typeof schema.playlists.$inferSelect, mark: Mark): SyncPlaylist => {
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
};

/** A collaborative playlist's Library entry as stored (`playlist_items.library_entry`). */
const readLibraryEntry = (stored: string | null): CollaborativeLibraryEntry | null => {
  if (stored === null) return null;
  try {
    return JSON.parse(stored) as CollaborativeLibraryEntry;
  } catch {
    return null;
  }
};

/**
 * Up to [limit] entries changed here that the account doesn't have yet, of the playlists
 * [where] takes, as the service's rows. A Library entry of a collaborative playlist carries
 * its song's own fields (Core's `libraryEntryFields`), or goes up as it came when another
 * member added it.
 */
const unpushedEntries = (
  db: LibraryDatabase,
  where: ReturnType<typeof sql>,
  limit: number,
  mark: Mark,
  after = 0,
): SyncPlaylistEntry[] => {
  const { accountSongs, albums, playlists, playlistItems, tracks, collaborations } = schema;
  return db
    .select({
      id: playlistItems.id,
      syncId: playlistItems.syncId,
      playlistId: playlists.syncId,
      orderKey: playlistItems.orderKey,
      songId: tracks.recordingKey,
      ytSong: playlistItems.ytSong,
      removedAt: playlistItems.removedAt,
      restoredAt: playlistItems.restoredAt,
      addedAt: playlistItems.addedAt,
      changedAt: playlistItems.changedAt,
      phoneId: playlistItems.phoneId,
      deleted: playlistItems.deleted,
      libraryEntry: playlistItems.libraryEntry,
      collaborative: sql<number | null>`${collaborations.playlistSyncId} IS NOT NULL`,
      // The account removed the Track's song: what it goes up as instead (`leftSong`).
      songGone: accountSongs.deleted,
      ...leavingSongColumns,
    })
    .from(playlistItems)
    .innerJoin(playlists, eq(playlistItems.playlistId, playlists.id))
    .leftJoin(tracks, eq(playlistItems.trackId, tracks.id))
    .leftJoin(albums, eq(tracks.albumId, albums.id))
    .leftJoin(accountSongs, eq(accountSongs.recordingKey, tracks.recordingKey))
    .leftJoin(collaborations, eq(collaborations.playlistSyncId, playlists.syncId))
    .where(
      and(
        eq(playlistItems.pushed, false),
        gt(playlistItems.id, after),
        where,
        // A Track not keyed yet can't be named to the account: its entry waits.
        or(
          isNull(playlistItems.trackId),
          isNotNull(tracks.recordingKey),
          isNotNull(playlistItems.libraryEntry),
        ),
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
      const kept = row.collaborative === 1 ? readLibraryEntry(row.libraryEntry) : null;
      const left = kept === null ? leftSong(row) : null;
      const songId = kept?.songId ?? (left === null ? row.songId : null);
      const song =
        kept !== null
          ? {
              title: kept.title,
              credit: kept.credit,
              album: kept.album,
              durationMs: kept.durationMs,
              videoId: kept.videoId,
            }
          : row.collaborative === 1 && songId !== null && row.title !== null
            ? libraryEntryFields({
                recordingKey: songId,
                title: row.title,
                artist: row.artist ?? "",
                album: row.album,
                durationMs: row.durationMs ?? 0,
                videoId: row.videoId,
              })
            : {};
      const fields = {
        id: row.syncId,
        ...stamp(row),
        playlistId: row.playlistId,
        orderKey: row.orderKey,
        songId,
        ytSong: songId === null ? (left ?? row.ytSong) : null,
        addedAt: row.addedAt,
        restoredAt: row.restoredAt,
        ...song,
      };
      if (!row.deleted) return { ...fields, deleted: false, removedAt: null };
      return row.removedAt === null
        ? { id: row.syncId, ...stamp(row), deleted: true }
        : { ...fields, deleted: true, removedAt: row.removedAt };
    });
};

/**
 * What a member's push of the collaborative playlist [playlistSyncId] sends: its row and
 * up to [limit] of its entries changed here, as `selectUnpushed` reads them; every other
 * table empty.
 */
export const selectUnpushedPlaylist = (
  db: LibraryDatabase,
  playlistSyncId: string,
  limit: number,
): UnpushedRows => {
  const { playlists } = schema;
  const { marks, mark } = marker();
  const playlistRows = db
    .select()
    .from(playlists)
    .where(and(eq(playlists.pushed, false), eq(playlists.syncId, playlistSyncId)))
    .all()
    .map((row) => playlistRow(row, mark));
  return {
    rows: {
      ...EMPTY_SYNC_TABLES,
      playlists: playlistRows,
      playlistEntries: unpushedEntries(
        db,
        sql`${playlists.syncId} = ${playlistSyncId}`,
        limit,
        mark,
      ),
    },
    marks,
  };
};

/**
 * Up to [limit] rows of each table that changed here and aren't on the
 * account yet, as the service's rows: songs by recording key, entries,
 * stars and plays pointing at recording keys, preferences with the value
 * [preferenceValue] gives, follows by their name key, dislikes by recording
 * key or, for a YT Music song, as they're kept. A star or a dislike of two
 * Tracks with one key goes up once, the later change. The play going on now
 * waits until it ends.
 */
export const selectUnpushed = (
  db: LibraryDatabase,
  limit: number,
  preferenceValue: (key: string) => string | null,
): UnpushedRows => finishSteps(selectUnpushedSteps(db, limit, preferenceValue));

/** Rows one step of a push's read reads (#1450). */
const UNPUSHED_AT_ONCE = 250;

/**
 * Up to [limit] rows of a table, read `UNPUSHED_AT_ONCE` a step: [read] gives up to [count]
 * rows after the one [after] names (null: from the first), each with the key the next read
 * goes on after.
 */
function* inChunks<K, R>(
  limit: number,
  read: (after: K | null, count: number) => readonly { readonly after: K; readonly row: R }[],
): Generator<void, R[]> {
  const rows: R[] = [];
  for (let after: K | null = null; rows.length < limit;) {
    const count = Math.min(UNPUSHED_AT_ONCE, limit - rows.length);
    const chunk = read(after, count);
    for (const each of chunk) rows.push(each.row);
    const last = chunk[chunk.length - 1];
    if (last === undefined || chunk.length < count) break;
    after = last.after;
    yield;
  }
  return rows;
}

/**
 * `selectUnpushed` as steps for work that runs in slices (#1450): one table's read each, so
 * a push's read of up to [limit] rows a table never holds the JavaScript thread whole.
 */
export function* selectUnpushedSteps(
  db: LibraryDatabase,
  limit: number,
  preferenceValue: (key: string) => string | null,
): Generator<void, UnpushedRows> {
  const { accountSongs, playlists, favorites, tracks } = schema;
  const { preferenceChanges } = schema;
  const { playEvents, syncRemovals } = schema;
  const { marks, mark } = marker();

  /** The removals of [kind] whose rows are gone, as tombstones. */
  const removals = (kind: RemovalKind) =>
    db
      .select()
      .from(syncRemovals)
      .where(eq(syncRemovals.kind, kind))
      .orderBy(asc(syncRemovals.id))
      .limit(limit)
      .all()
      .map((row) => {
        mark(kind, row.id, { table: "removals", kind, id: row.id, changedAt: row.changedAt });
        return {
          id: row.id,
          changedAt: row.changedAt,
          phoneId: row.phoneId,
          deleted: true as const,
        };
      });

  const songs = yield* inChunks(limit, (after: string | null, count) =>
    db
      .select()
      .from(accountSongs)
      .where(
        and(
          eq(accountSongs.pushed, false),
          after === null ? undefined : gt(accountSongs.recordingKey, after),
        ),
      )
      .orderBy(asc(accountSongs.recordingKey))
      .limit(count)
      .all()
      .map((row) => {
        mark("songs", row.recordingKey, {
          table: "songs",
          key: row.recordingKey,
          changedAt: row.changedAt,
        });
        return { after: row.recordingKey, row: songRow(row) };
      }),
  );

  yield;
  const playlistRows = db
    .select()
    .from(playlists)
    .where(and(eq(playlists.pushed, false), notMemberPlaylist(playlists.syncId)))
    .orderBy(asc(playlists.id))
    .limit(limit)
    .all()
    .map((row) => playlistRow(row, mark));

  yield;
  // Entries are read in their local ids' order: each chunk goes on after the last one's, as marked.
  const entries = yield* inChunks(limit, (after: number | null, count) => {
    const ids: number[] = [];
    const marking: Mark = (table, id, from) => {
      mark(table, id, from);
      if (from.table === "entries") ids.push(from.id);
    };
    return unpushedEntries(db, notMemberPlaylist(playlists.syncId), count, marking, after ?? 0).map(
      (row, n) => ({ after: ids[n] ?? 0, row }),
    );
  });

  yield;
  const stars = yield* inChunks(limit, (after: number | null, count) =>
    db
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
      .where(
        and(
          eq(favorites.pushed, false),
          isNotNull(tracks.recordingKey),
          after === null ? undefined : gt(favorites.trackId, after),
        ),
      )
      .orderBy(asc(favorites.trackId))
      .limit(count)
      .all()
      .map((row) => {
        mark("favorites", row.recordingKey, {
          table: "favorites",
          trackId: row.trackId,
          changedAt: row.changedAt,
        });
        const star: SyncFavorite = row.deleted
          ? { id: row.recordingKey, ...stamp(row), deleted: true }
          : { id: row.recordingKey, ...stamp(row), deleted: false, addedAt: row.addedAt };
        return { after: row.trackId, row: star };
      }),
  );

  yield;
  const preferences = db
    .select()
    .from(preferenceChanges)
    .where(eq(preferenceChanges.pushed, false))
    .orderBy(asc(preferenceChanges.key))
    .all()
    // Retired stamps stay stored, but must not fill a batch ahead of active preferences.
    .filter((row) => syncsPreference(row.key))
    .slice(0, limit)
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

  /** Up to [count] plays waiting to go up, after the play [after]. */
  const unpushedPlays = (after: number | null, count: number) =>
    db
      .select({
        ...getTableColumns(playEvents),
        contextPlaylistId: sql<string | null>`CASE WHEN ${playEvents.contextType} = 'playlist' THEN
        (SELECT sync_id FROM playlists WHERE id = CAST(${playEvents.contextId} AS INTEGER))
        ELSE NULL END`,
        currentTitle: tracks.title,
        currentArtist: tracks.artistCredit,
        currentAlbum: schema.albums.title,
      })
      .from(playEvents)
      .leftJoin(tracks, eq(playEvents.trackId, tracks.id))
      .leftJoin(schema.albums, eq(tracks.albumId, schema.albums.id))
      .where(
        and(
          eq(playEvents.pushed, false),
          eq(playEvents.ongoing, false),
          isNotNull(playEvents.syncId),
          isNotNull(playEvents.recordingKey),
          after === null ? undefined : gt(playEvents.id, after),
        ),
      )
      .orderBy(asc(playEvents.id))
      .limit(count)
      .all();
  /** A play waiting to go up, as the service's row (null: not one to name yet). */
  const playRow = (row: ReturnType<typeof unpushedPlays>[number]): SyncPlayRow | null => {
    if (row.syncId === null || row.recordingKey === null) return null;
    mark("plays", row.syncId, { table: "plays", id: row.id });
    return {
      id: row.syncId,
      songId: row.recordingKey,
      startedAt: row.startedAt,
      listenedMs: row.listenedMs,
      durationMs: row.durationMs,
      endReason: row.endReason,
      counted: row.counted,
      contextType: row.contextType,
      contextId: row.contextId,
      contextPlaylistId: row.contextPlaylistId,
      source: row.source,
      importedFrom: row.importedFrom,
      snapshot: wireSnapshot(
        row.snapshot ?? {
          title: row.currentTitle ?? UNKNOWN_SONG_TITLE,
          artist: row.currentArtist ?? "",
          album: row.currentAlbum,
          artworkPath: null,
          thumbPath: null,
        },
      ),
      videoId: row.videoId,
    };
  };

  yield;
  const plays = yield* inChunks(limit, (after: number | null, count) =>
    unpushedPlays(after, count).flatMap((row) => {
      const play = playRow(row);
      return play === null ? [] : [{ after: row.id, row: play }];
    }),
  );

  const { follows, hiddenFollowReleases, notifiedFollowShows, dismissedFollowSuggestions } = schema;
  yield;
  const followRows = db
    .select()
    .from(follows)
    .where(eq(follows.pushed, false))
    .orderBy(asc(follows.key))
    .limit(limit)
    .all()
    .map((row): SyncFollow => {
      mark("follows", row.key, { table: "follows", key: row.key, changedAt: row.changedAt });
      return row.deleted
        ? { id: row.key, ...stamp(row), deleted: true }
        : {
            id: row.key,
            ...stamp(row),
            deleted: false,
            name: row.name,
            level: row.level,
            followedAt: row.followedAt,
            deezerId: row.deezerId,
            ytBrowseId: row.ytBrowseId,
          };
    });

  /** Rows of a table whose id is all they carry (a hidden release, a notified show). */
  const idRows = (
    table: "hiddenReleases" | "notifiedShows",
    rows: readonly {
      readonly id: string;
      readonly changedAt: number;
      readonly phoneId: string;
      readonly deleted: boolean;
    }[],
  ) =>
    rows.map((row) => {
      mark(table, row.id, { table, key: row.id, changedAt: row.changedAt });
      return { id: row.id, ...stamp(row) } as SyncTables[typeof table][number];
    });
  yield;
  const hiddenReleases = idRows(
    "hiddenReleases",
    db
      .select({ ...getTableColumns(hiddenFollowReleases), id: hiddenFollowReleases.key })
      .from(hiddenFollowReleases)
      .where(eq(hiddenFollowReleases.pushed, false))
      .orderBy(asc(hiddenFollowReleases.key))
      .limit(limit)
      .all(),
  );
  yield;
  const notifiedShows = idRows(
    "notifiedShows",
    db
      .select()
      .from(notifiedFollowShows)
      .where(eq(notifiedFollowShows.pushed, false))
      .orderBy(asc(notifiedFollowShows.id))
      .limit(limit)
      .all(),
  );
  yield;
  const dismissedSuggestions = db
    .select()
    .from(dismissedFollowSuggestions)
    .where(eq(dismissedFollowSuggestions.pushed, false))
    .orderBy(asc(dismissedFollowSuggestions.key))
    .limit(limit)
    .all()
    .map((row): SyncDismissedSuggestion => {
      mark("dismissedSuggestions", row.key, {
        table: "dismissedSuggestions",
        key: row.key,
        changedAt: row.changedAt,
      });
      return row.deleted
        ? { id: row.key, ...stamp(row), deleted: true }
        : { id: row.key, ...stamp(row), deleted: false, dismissedAt: row.dismissedAt };
    });

  const { dislikes } = schema;
  yield;
  const dislikeRows = db
    .select({
      key: dislikes.songKey,
      recordingKey: tracks.recordingKey,
      title: dislikes.title,
      artists: dislikes.artists,
      durationMs: dislikes.durationMs,
      dislikedAt: dislikes.dislikedAt,
      changedAt: dislikes.changedAt,
      phoneId: dislikes.phoneId,
      deleted: dislikes.deleted,
    })
    .from(dislikes)
    .leftJoin(tracks, libraryDislike)
    // A Library song's dislike is named by its Track's recording key: one whose
    // Track is gone or not keyed yet waits. A YT Music song's goes up as it's kept.
    .where(
      and(
        eq(dislikes.pushed, false),
        or(like(dislikes.songKey, YT_DISLIKES), isNotNull(tracks.recordingKey)),
      ),
    )
    .orderBy(asc(dislikes.songKey))
    .limit(limit)
    .all()
    .map((row): SyncDislike => {
      const id = row.recordingKey ?? row.key;
      mark("dislikes", id, { table: "dislikes", key: row.key, changedAt: row.changedAt });
      return row.deleted
        ? { id, ...stamp(row), deleted: true }
        : {
            id,
            ...stamp(row),
            deleted: false,
            title: row.title,
            artists: row.artists,
            durationMs: row.durationMs,
            dislikedAt: row.dislikedAt,
          };
    });

  yield;
  const entryRemovals = removals("playlistEntries");
  yield;
  const starRemovals = removals("favorites");
  return {
    rows: {
      songs,
      playlists: playlistRows,
      playlistEntries: [...entries, ...entryRemovals],
      // Two Tracks with one key are one song for the account: one star, the later change.
      favorites: mergeRows([], [...stars, ...starRemovals]).rows,
      preferences,
      plays,
      follows: followRows,
      hiddenReleases,
      notifiedShows,
      dismissedSuggestions,
      // As stars: two Tracks with one key are one song for the account.
      dislikes: mergeRows([], dislikeRows).rows,
    },
    marks,
  };
}

/** The dislikes of YT Music songs, by how their key starts (Core's `ytTrackId`). */
const YT_DISLIKES = "yt:%";

/** A Library song's dislike and its Track: the dislike is kept under the Track's id as text. */
const libraryDislike = sql`${schema.tracks.id} = CAST(${schema.dislikes.songKey} AS INTEGER)
  AND ${schema.dislikes.songKey} NOT LIKE ${YT_DISLIKES}`;

/** The tables a push mark names by one text key: the follow tables and the dislikes. */
const followRows = {
  follows: { table: schema.follows, key: schema.follows.key },
  hiddenReleases: { table: schema.hiddenFollowReleases, key: schema.hiddenFollowReleases.key },
  notifiedShows: { table: schema.notifiedFollowShows, key: schema.notifiedFollowShows.id },
  dismissedSuggestions: {
    table: schema.dismissedFollowSuggestions,
    key: schema.dismissedFollowSuggestions.key,
  },
  dislikes: { table: schema.dislikes, key: schema.dislikes.songKey },
} as const;

/**
 * Records that the account has the changes behind [marks] (`selectUnpushed`).
 * A row changed again since it was read keeps waiting. A row the service
 * stored with its own time, because the one pushed was ahead of its clock
 * ([storedAt], by mark), takes that time, so the phone and the service agree.
 */
export const markPushed = (
  db: LibraryDatabase,
  marks: readonly PushMark[],
  storedAt: ReadonlyMap<PushMark, number> = new Map(),
): void => {
  db.transaction((tx) => finishSteps(markPushedSteps(tx, marks, storedAt)));
};

/** How many push marks one step of `markPushedSteps` records. */
const MARKS_AT_ONCE = 50;

/**
 * `markPushed` as steps for work that runs in slices (#1450): up to `MARKS_AT_ONCE` marks a
 * step, each step its own transaction. A sync stopped between steps leaves the rest waiting,
 * and they go up again with the next push, which the account takes as no change.
 */
export function* markPushedSteps(
  db: LibraryDatabase,
  marks: readonly PushMark[],
  storedAt: ReadonlyMap<PushMark, number> = new Map(),
): Generator<void, void> {
  for (let start = 0; start < marks.length; start += MARKS_AT_ONCE) {
    if (start > 0) yield;
    markSome(db, marks.slice(start, start + MARKS_AT_ONCE), storedAt);
  }
}

const markSome = (
  db: LibraryDatabase,
  marks: readonly PushMark[],
  storedAt: ReadonlyMap<PushMark, number>,
): void => {
  /** What a pushed row behind [from] becomes. */
  const pushedAs = (from: PushMark & { readonly changedAt: number }) => {
    const at = storedAt.get(from);
    return at === undefined || at >= from.changedAt
      ? { pushed: true }
      : { pushed: true, changedAt: at };
  };
  const { accountSongs, playlists, playlistItems, favorites, preferenceChanges, playEvents } =
    schema;
  const { syncRemovals } = schema;
  db.transaction((tx) => {
    const plays: number[] = [];
    for (const from of marks) {
      switch (from.table) {
        case "songs":
          tx.update(accountSongs)
            .set(pushedAs(from))
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
            .set(pushedAs(from))
            .where(and(eq(playlists.id, from.id), eq(playlists.changedAt, from.changedAt)))
            .run();
          break;
        case "entries":
          tx.update(playlistItems)
            .set(pushedAs(from))
            .where(and(eq(playlistItems.id, from.id), eq(playlistItems.changedAt, from.changedAt)))
            .run();
          break;
        case "favorites":
          tx.update(favorites)
            .set(pushedAs(from))
            .where(
              and(eq(favorites.trackId, from.trackId), eq(favorites.changedAt, from.changedAt)),
            )
            .run();
          break;
        case "preferences":
          tx.update(preferenceChanges)
            .set(pushedAs(from))
            .where(
              and(
                eq(preferenceChanges.key, from.key),
                eq(preferenceChanges.changedAt, from.changedAt),
              ),
            )
            .run();
          break;
        case "follows":
        case "hiddenReleases":
        case "notifiedShows":
        case "dismissedSuggestions":
        case "dislikes": {
          const { table, key } = followRows[from.table];
          tx.update(table)
            .set(pushedAs(from))
            .where(and(eq(key, from.key), eq(table.changedAt, from.changedAt)))
            .run();
          break;
        }
        case "plays":
          plays.push(from.id);
          break;
        case "removals":
          tx.delete(syncRemovals)
            .where(
              and(
                eq(syncRemovals.kind, from.kind),
                eq(syncRemovals.id, from.id),
                eq(syncRemovals.changedAt, from.changedAt),
              ),
            )
            .run();
          break;
      }
    }
    for (const ids of chunks(plays)) {
      tx.update(playEvents).set({ pushed: true }).where(inArray(playEvents.id, ids)).run();
    }
  });
};

// --- The song list -------------------------------------------------------------

/** Rows one step of a sync's song-list reads takes (#1450). */
const SONGS_AT_ONCE = 250;
/** Songs one step of a sync's song-list writes writes, in one transaction (#1450). */
const SONG_WRITES_AT_ONCE = 50;

/**
 * The phone's songs as the account would hold them: every Track with a file and a key, by id,
 * `SONGS_AT_ONCE` a step.
 */
function* selectPhoneSongsSteps(db: LibraryDatabase): Generator<void, PhoneSong[]> {
  const { tracks, albums, genres } = schema;
  const songs: PhoneSong[] = [];
  for (let after = 0; ;) {
    const rows = db
      .select({
        id: tracks.id,
        recordingKey: sql<string>`${tracks.recordingKey}`,
        title: tracks.title,
        credit: tracks.artistCredit,
        album: albums.title,
        albumArtist: albums.albumArtistCredit,
        discNumber: tracks.discNumber,
        trackNumber: tracks.trackNumber,
        durationMs: tracks.durationMs,
        releaseDate: tracks.releaseDate,
        year: tracks.year,
        genre: genres.name,
        videoId: tracks.videoId,
        addedAt: tracks.addedAt,
      })
      .from(tracks)
      .innerJoin(albums, eq(tracks.albumId, albums.id))
      .leftJoin(genres, eq(tracks.genreId, genres.id))
      .where(and(gt(tracks.id, after), hasFile, isNotNull(tracks.recordingKey)))
      .orderBy(asc(tracks.id))
      .limit(SONGS_AT_ONCE)
      .all();
    for (const { id, recordingKey, ...fields } of rows) {
      songs.push({
        recordingKey,
        fields: { ...fields, album: fields.album === UNKNOWN_ALBUM ? null : fields.album },
      });
      after = id;
    }
    if (rows.length < SONGS_AT_ONCE) return songs;
    yield;
  }
}

/** The account's song list as this phone keeps it, `SONGS_AT_ONCE` a step. */
function* selectAccountSongsSteps(db: LibraryDatabase): Generator<void, AccountSongState[]> {
  const { accountSongs } = schema;
  const account: AccountSongState[] = [];
  for (let after: string | null = null; ;) {
    const rows = db
      .select()
      .from(accountSongs)
      .where(after === null ? undefined : gt(accountSongs.recordingKey, after))
      .orderBy(asc(accountSongs.recordingKey))
      .limit(SONGS_AT_ONCE)
      .all();
    for (const row of rows) {
      account.push({ row: songRow(row), local: row.local });
      after = row.recordingKey;
    }
    if (rows.length < SONGS_AT_ONCE) return account;
    yield;
  }
}

/**
 * Brings the account's song list up to date with the phone's (Core's
 * `planSongSync`): the songs it lacks, and those retagged here, wait to go
 * up as of [now].
 */
export const planSongs = (db: LibraryDatabase, now: number): void => {
  db.transaction((tx) => finishSteps(planSongsSteps(tx, now)));
};

/**
 * `planSongs` as steps for work that runs in slices (#1450): the song lists read a few
 * hundred rows a step, then planned, then written `SONG_WRITES_AT_ONCE` songs a step, each
 * step's writes one transaction. A change to the Library meanwhile (a scan) marks the songs
 * changed again, and the next sync plans them anew.
 */
export function* planSongsSteps(db: LibraryDatabase, now: number): Generator<void, void> {
  const { accountSongs } = schema;
  const account = yield* selectAccountSongsSteps(db);
  yield;
  const phone = yield* selectPhoneSongsSteps(db);
  yield;
  const plan = planSongSync({ phone, account, now, phoneId: selectPhoneId(db) });
  if (plan.push.length === 0 && plan.local.length === 0) return;
  const local = new Map(plan.local.map((entry) => [entry.recordingKey, entry.local]));
  const pushed = plan.push.map((row) => {
    const values = {
      song: storedSong(row),
      ...stamp(row),
      pushed: false,
      local: local.get(row.id) ?? null,
    };
    local.delete(row.id);
    return { recordingKey: row.id, values };
  });
  const localOnly = [...local];
  for (let start = 0; start < pushed.length; start += SONG_WRITES_AT_ONCE) {
    yield;
    db.transaction((tx) => {
      for (const { recordingKey, values } of pushed.slice(start, start + SONG_WRITES_AT_ONCE)) {
        tx.insert(accountSongs)
          .values({ recordingKey, ...values })
          .onConflictDoUpdate({ target: accountSongs.recordingKey, set: values })
          .run();
      }
    });
  }
  for (let start = 0; start < localOnly.length; start += SONG_WRITES_AT_ONCE) {
    yield;
    db.transaction((tx) => {
      for (const [recordingKey, text] of localOnly.slice(start, start + SONG_WRITES_AT_ONCE)) {
        tx.update(accountSongs)
          .set({ local: text })
          .where(eq(accountSongs.recordingKey, recordingKey))
          .run();
      }
    });
  }
}

/**
 * Tracks [leaving] their recording keys while the Library is joined with an
 * account (Core's `songsLeaving`): a song no Track keeps leaves the account,
 * its star with it, as tombstones the next push sends. [removed] Tracks
 * leave the Library, with the playlist entries still holding them (kept
 * ones, `keepPlaylistEntries`, hold none by then), except those of another
 * account's collaborative playlist, which stay; retagged ones keep
 * theirs. Run it in the transaction that removes the Tracks, after it keeps
 * their entries and before it deletes them, or that retags them, after.
 */
export const leaveKeys = (
  tx: LibraryDatabase,
  leaving: readonly { readonly trackId: number; readonly recordingKey: string }[],
  { removed, now }: { readonly removed: boolean; readonly now: number },
): void => {
  if (leaving.length === 0 || selectJoinedAccount(tx) === null) return;
  const { tracks, favorites, playlistItems, accountSongs, syncRemovals } = schema;
  const ids = leaving.map((track) => track.trackId);
  const keys = [...new Set(leaving.map((track) => track.recordingKey))];
  // A star or an entry the account may hold: live, or removed here since the last push.
  const onAccount = (table: typeof favorites | typeof playlistItems) =>
    or(eq(table.deleted, false), eq(table.pushed, false));
  const stars = new Map(
    chunks(ids).flatMap((some) =>
      tx
        .select({ trackId: favorites.trackId, changedAt: favorites.changedAt })
        .from(favorites)
        .where(and(inArray(favorites.trackId, some), onAccount(favorites)))
        .all()
        .map((row) => [row.trackId, { changedAt: row.changedAt }] as const),
    ),
  );
  const entries = new Map<number, { id: string; changedAt: number }[]>();
  for (const some of removed ? chunks(ids) : []) {
    const rows = tx
      .select({
        trackId: sql<number>`${playlistItems.trackId}`,
        id: playlistItems.syncId,
        changedAt: playlistItems.changedAt,
      })
      .from(playlistItems)
      .innerJoin(schema.playlists, eq(playlistItems.playlistId, schema.playlists.id))
      .where(
        and(
          inArray(playlistItems.trackId, some),
          onAccount(playlistItems),
          // Another account's collaborative playlist keeps its entries (`deleteTracksById`).
          notMemberPlaylist(schema.playlists.syncId),
        ),
      )
      .all();
    for (const { trackId, ...entry } of rows) {
      const held = entries.get(trackId);
      if (held === undefined) entries.set(trackId, [entry]);
      else held.push(entry);
    }
  }
  const leavingIds = new Set(ids);
  const staying = chunks(keys).flatMap((some) =>
    tx
      .select({
        id: tracks.id,
        recordingKey: sql<string>`${tracks.recordingKey}`,
        starred: sql<number | null>`${favorites.deleted} = 0`,
      })
      .from(tracks)
      .leftJoin(favorites, eq(favorites.trackId, tracks.id))
      .where(inArray(tracks.recordingKey, some))
      .all()
      .filter((track) => !leavingIds.has(track.id))
      .map((track) => ({ recordingKey: track.recordingKey, starred: track.starred === 1 })),
  );
  const account = chunks(keys).flatMap((some) =>
    tx
      .select({
        recordingKey: accountSongs.recordingKey,
        changedAt: accountSongs.changedAt,
        deleted: accountSongs.deleted,
      })
      .from(accountSongs)
      .where(inArray(accountSongs.recordingKey, some))
      .all(),
  );
  const removal = songsLeaving({
    leaving: leaving.map((track) => ({
      recordingKey: track.recordingKey,
      star: stars.get(track.trackId) ?? null,
      entries: entries.get(track.trackId) ?? [],
    })),
    staying,
    account,
    now,
    phoneId: selectPhoneId(tx),
  });
  for (const row of removal.songs) {
    const values = { song: null, ...stamp(row), pushed: false, local: null };
    tx.insert(accountSongs)
      .values({ recordingKey: row.id, ...values })
      .onConflictDoUpdate({ target: accountSongs.recordingKey, set: values })
      .run();
  }
  const outgoing = [
    ...removal.favorites.map((row) => ({ kind: "favorites" as const, row })),
    ...removal.playlistEntries.map((row) => ({ kind: "playlistEntries" as const, row })),
  ];
  for (const { kind, row } of outgoing) {
    const values = { changedAt: row.changedAt, phoneId: row.phoneId };
    tx.insert(syncRemovals)
      .values({ kind, id: row.id, ...values })
      .onConflictDoUpdate({ target: [syncRemovals.kind, syncRemovals.id], set: values })
      .run();
  }
  if (removed) return;
  // Retagged: the star and the entries stay with the Track, and go up again under its new key.
  for (const some of chunks(ids)) {
    tx.update(favorites)
      .set(stamped(favorites, now))
      .where(and(inArray(favorites.trackId, some), eq(favorites.deleted, false)))
      .run();
    tx.update(playlistItems)
      .set(stamped(playlistItems, now))
      .where(and(inArray(playlistItems.trackId, some), eq(playlistItems.deleted, false)))
      .run();
    // So does the dislike, kept under the Track's id.
    tx.update(schema.dislikes)
      .set(stamped(schema.dislikes, now))
      .where(
        and(inArray(schema.dislikes.songKey, some.map(String)), eq(schema.dislikes.deleted, false)),
      )
      .run();
  }
};

// --- What comes down -----------------------------------------------------------

/** What applying rows from the account changed on the phone. */
export interface PulledChanges {
  readonly songs: boolean;
  readonly playlists: boolean;
  readonly favorites: boolean;
  readonly plays: boolean;
  /** Follows, hidden releases or notified shows changed. */
  readonly follows: boolean;
  /** Dismissed follow suggestions changed (a dismissal or its Undo). */
  readonly dismissedSuggestions: boolean;
  /** Dislikes changed (one set or removed). */
  readonly dislikes: boolean;
  /** The synced preferences whose value changed, with the value (null: none, its default). */
  readonly preferences: readonly { readonly key: string; readonly value: string | null }[];
}

interface Changed {
  songs: boolean;
  playlists: boolean;
  favorites: boolean;
  plays: boolean;
  follows: boolean;
  dismissedSuggestions: boolean;
  dislikes: boolean;
  preferences: { key: string; value: string | null }[];
}

const nothingChanged = (): Changed => ({
  songs: false,
  playlists: false,
  favorites: false,
  plays: false,
  follows: false,
  dismissedSuggestions: false,
  dislikes: false,
  preferences: [],
});

/** A Track as Core's `collaborativeEntryMatcher` reads it, with its id here. */
type MatchTrack = EntryTrack & { readonly id: number };

/** How pulled rows find their place on this device. */
interface Placing {
  /** Which Track each recording key is (`selectAccountTrackIds`). */
  readonly trackIds: ReadonlyMap<string, number>;
  /** The collaborative playlists the device holds a record of, by sync id. */
  readonly collaborative: ReadonlySet<string>;
  /** The same playlists, by their id here. */
  readonly collaborativeIds: ReadonlySet<number>;
  /** What this device plays for a collaborative playlist's Library entry. */
  readonly match: (entry: CollaborativeLibraryEntry) => CollaborativeEntryMatch<MatchTrack> | null;
  readonly phoneId: string;
  /** The collaborative playlists (ids here) a change this device didn't make reached. */
  readonly changedElsewhere: Set<number>;
}

/** The Library entries among [entries]: those naming a song by its recording key. */
const libraryEntries = (entries: readonly SyncPlaylistEntry[]) =>
  entries.flatMap((row) =>
    "playlistId" in row && row.songId !== null
      ? [{ songId: row.songId, title: row.title ?? null, videoId: row.videoId ?? null }]
      : [],
  );

/**
 * The Tracks Core's `collaborativeEntryMatcher` could pick for [entries]: those with one of
 * their recording keys or video ids, or a title that matches as theirs does (`matchTitle`, and
 * any Track not given one yet). The matcher finds among them what it would among every Track.
 */
const entryCandidates = (
  tx: LibraryDatabase,
  entries: readonly SyncPlaylistEntry[],
): MatchTrack[] => {
  const { tracks, albums } = schema;
  const wanted = libraryEntries(entries);
  const read = (where: SQL) =>
    tx
      .select({
        id: tracks.id,
        recordingKey: sql<string>`${tracks.recordingKey}`,
        title: tracks.title,
        artist: tracks.artistCredit,
        album: albums.title,
        durationMs: tracks.durationMs,
        videoId: tracks.videoId,
      })
      .from(tracks)
      .innerJoin(albums, eq(tracks.albumId, albums.id))
      .where(and(isNotNull(tracks.recordingKey), where))
      .all();
  const found = new Map<number, MatchTrack>();
  const by = (
    column: typeof tracks.recordingKey | typeof tracks.videoId | typeof tracks.matchTitle,
    values: readonly (string | null)[],
  ) => {
    const some = [...new Set(values.filter((value): value is string => value !== null))];
    for (const chunk of chunks(some)) {
      for (const row of read(inArray(column, chunk))) found.set(row.id, row);
    }
  };
  by(
    tracks.recordingKey,
    wanted.map((entry) => entry.songId),
  );
  by(
    tracks.videoId,
    wanted.map((entry) => entry.videoId),
  );
  by(
    tracks.matchTitle,
    wanted.map((entry) => (entry.title === null ? null : recordingMatchTitle(entry.title))),
  );
  if (wanted.some((entry) => entry.title !== null)) {
    for (const row of read(isNull(tracks.matchTitle))) found.set(row.id, row);
  }
  // oxlint-disable-next-line unicorn/no-array-sort -- sorts a fresh array; Hermes lacks toSorted
  return [...found.values()].sort((a, b) => a.id - b.id);
};

/**
 * How [tx] places pulled rows: [trackIds] for recording keys, and for a collaborative
 * playlist's Library entries a matcher over the Tracks the pulled [entries] could be.
 */
const placing = (
  tx: LibraryDatabase,
  trackIds: ReadonlyMap<string, number>,
  entries: readonly SyncPlaylistEntry[],
): Placing => {
  const { collaborations, playlists } = schema;
  const held = tx
    .select({ syncId: collaborations.playlistSyncId, id: playlists.id })
    .from(collaborations)
    .leftJoin(playlists, eq(playlists.syncId, collaborations.playlistSyncId))
    .all();
  let matcher: Placing["match"] | null = null;
  return {
    trackIds,
    collaborative: new Set(held.map((row) => row.syncId)),
    collaborativeIds: new Set(held.flatMap((row) => (row.id === null ? [] : [row.id]))),
    match: (entry) => {
      matcher ??= collaborativeEntryMatcher(entryCandidates(tx, entries));
      return matcher(entry);
    },
    phoneId: selectPhoneId(tx),
    changedElsewhere: new Set(),
  };
};

/** Marks the collaborative playlists a pull changed from elsewhere as not seen here yet. */
const markUnseen = (tx: LibraryDatabase, place: Placing): void => {
  const { collaborations, playlists } = schema;
  for (const ids of chunks([...place.changedElsewhere])) {
    tx.update(collaborations)
      .set({ unseen: true })
      .where(
        inArray(
          collaborations.playlistSyncId,
          tx.select({ syncId: playlists.syncId }).from(playlists).where(inArray(playlists.id, ids)),
        ),
      )
      .run();
  }
};

/** Whether change [row] wins over the [held] change of the same row (Core's `mergeRows`). */
const wins = (row: SyncRow, held: Omit<SyncRow, "id"> | undefined): boolean =>
  held === undefined || mergeRows([{ ...held, id: row.id }], [row]).accepted.length > 0;

/** Whether an entry's change [row] wins over the [held] one (Core's `mergePlaylistEntries`). */
const entryWins = (row: SyncEntryRow, held: Omit<SyncEntryRow, "id"> | undefined): boolean =>
  held === undefined || mergePlaylistEntries([{ ...held, id: row.id }], [row]).accepted.length > 0;

type PendingKind = "playlistEntries" | "favorites" | "plays" | "dislikes";

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
  const beats = kind === "playlistEntries" ? entryWins(row, waiting) : wins(row, waiting);
  if (!beats) return false;
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

const applyPlaylist = (
  tx: LibraryDatabase,
  row: SyncPlaylist,
  now: number,
  place: Placing,
): boolean => {
  const { playlists } = schema;
  const held = tx.select().from(playlists).where(eq(playlists.syncId, row.id)).get();
  if (held !== undefined && !wins(row, held)) return false;
  if (held !== undefined && place.collaborativeIds.has(held.id) && row.phoneId !== place.phoneId)
    place.changedElsewhere.add(held.id);
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

/**
 * Where a pulled Library entry ([row], of a song with the recording key [songId]) lands
 * here: the Track the key names, or for a collaborative playlist's entry the one Core's
 * `collaborativeEntryMatcher` finds by its fields, else the song streamed or searched for
 * (an entry it carries no title for waits for its Track, as any other); and the entry as the
 * account holds it, kept for a collaborative playlist so it goes up as it came.
 */
const placeLibraryEntry = (
  row: Extract<SyncPlaylistEntry, { readonly playlistId: string }>,
  songId: string,
  place: Placing,
): {
  readonly trackId: number | null | undefined;
  readonly ytSong: string | null;
  readonly libraryEntry: string | null;
} => {
  if (!place.collaborative.has(row.playlistId)) {
    return { trackId: place.trackIds.get(songId), ytSong: null, libraryEntry: null };
  }
  const entry: CollaborativeLibraryEntry = {
    songId,
    title: row.title ?? null,
    credit: row.credit ?? null,
    album: row.album ?? null,
    durationMs: row.durationMs ?? null,
    videoId: row.videoId ?? null,
  };
  const libraryEntry = JSON.stringify(entry);
  const match = place.match(entry);
  if (match === null) return { trackId: place.trackIds.get(songId), ytSong: null, libraryEntry };
  if (match.source === "library") return { trackId: match.track.id, ytSong: null, libraryEntry };
  return { trackId: null, ytSong: writeEntrySong(match), libraryEntry };
};

/**
 * Applies a pulled entry; true when it changed the phone's. A live entry it
 * places adds its playlist to [placed], for `keepOneEntryPerSong`.
 */
const applyEntry = (
  tx: LibraryDatabase,
  row: SyncPlaylistEntry,
  place: Placing,
  placed: Set<number>,
): boolean => {
  const { playlists, playlistItems } = schema;
  if (!beatsPending(tx, "playlistEntries", row)) return false;
  const held = tx.select().from(playlistItems).where(eq(playlistItems.syncId, row.id)).get();
  if (held !== undefined && !entryWins(row, held)) {
    // The device's own entry back from the service, which wrote who added it: the page
    // shows the initial at once.
    const addedBy = "addedBy" in row ? row.addedBy : undefined;
    if (typeof addedBy !== "string" || held.addedBy !== null) return false;
    tx.update(playlistItems).set({ addedBy }).where(eq(playlistItems.id, held.id)).run();
    return true;
  }
  const elsewhere = (playlistId: number): void => {
    if (place.collaborativeIds.has(playlistId) && row.phoneId !== place.phoneId)
      place.changedElsewhere.add(playlistId);
  };
  if (row.deleted && !("removedAt" in row && typeof row.removedAt === "number")) {
    if (held === undefined) return false;
    tx.update(playlistItems)
      .set({ ...stamp(row), removedAt: null, pushed: true })
      .where(eq(playlistItems.id, held.id))
      .run();
    elsewhere(held.playlistId);
    return true;
  }
  if (!("playlistId" in row)) return false;
  const playlist = tx
    .select({ id: playlists.id })
    .from(playlists)
    .where(eq(playlists.syncId, row.playlistId))
    .get();
  const song =
    row.songId === null
      ? { trackId: null, ytSong: row.ytSong, libraryEntry: null }
      : placeLibraryEntry(row, row.songId, place);
  const { trackId } = song;
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
    ytSong: trackId === null ? song.ytSong : null,
    libraryEntry: song.libraryEntry,
    ...(row.addedBy === undefined ? {} : { addedBy: row.addedBy }),
    removedAt: row.removedAt ?? null,
    restoredAt: row.restoredAt ?? null,
    orderKey: row.orderKey,
    addedAt: row.addedAt,
    ...stamp(row),
    pushed: true,
  };
  elsewhere(playlist.id);
  if (held !== undefined) {
    tx.update(playlistItems).set(values).where(eq(playlistItems.id, held.id)).run();
  } else {
    tx.insert(playlistItems)
      .values({ syncId: row.id, ...values })
      .run();
  }
  if (!row.deleted) placed.add(playlist.id);
  return true;
};

/**
 * Removes, from the [playlists] given (local ids), each entry of a song the
 * playlist already holds (Core's `duplicatePlaylistEntries`): the one added
 * later goes, as a removal that skips the Graveyard and goes up.
 */
const keepOneEntryPerSong = (
  tx: LibraryDatabase,
  playlists: ReadonlySet<number>,
  now: number,
): void => {
  if (playlists.size === 0) return;
  const { playlistItems, tracks } = schema;
  const entries = tx
    .select({
      id: playlistItems.id,
      syncId: playlistItems.syncId,
      playlistId: playlistItems.playlistId,
      addedAt: playlistItems.addedAt,
      songId: tracks.recordingKey,
      ytSong: playlistItems.ytSong,
      libraryEntry: playlistItems.libraryEntry,
    })
    .from(playlistItems)
    .leftJoin(tracks, eq(playlistItems.trackId, tracks.id))
    .where(and(inArray(playlistItems.playlistId, [...playlists]), eq(playlistItems.deleted, false)))
    .all()
    .map((row) => {
      // A collaborative playlist's Library entry is compared by the fields it carries.
      const kept = readLibraryEntry(row.libraryEntry);
      return {
        local: row.id,
        id: row.syncId,
        playlistId: String(row.playlistId),
        addedAt: row.addedAt,
        deleted: false,
        song: playlistEntrySong(
          kept === null ? { songId: row.songId, ytSong: row.ytSong } : { ...kept, ytSong: null },
        ),
      };
    });
  const gone = duplicatePlaylistEntries(entries).map((entry) => entry.local);
  for (const ids of chunks(gone)) {
    tx.update(playlistItems)
      .set({ deleted: true, removedAt: null, ...stamped(playlistItems, now) })
      .where(inArray(playlistItems.id, ids))
      .run();
  }
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

/**
 * A dislike from the account: a YT Music song's is kept as it comes, a
 * Library song's under the phone's Track of its recording key, waiting in
 * `sync_pending` until the phone has one.
 */
const applyDislike = (
  tx: LibraryDatabase,
  row: SyncDislike,
  trackIds: ReadonlyMap<string, number>,
): boolean => {
  const { dislikes } = schema;
  if (!beatsPending(tx, "dislikes", row)) return false;
  const trackId = trackIds.get(row.id);
  if (trackId === undefined && parseTrackId(row.id)?.kind !== "yt") {
    pend(tx, "dislikes", row, { songKey: row.id });
    return false;
  }
  const songKey = trackId === undefined ? row.id : String(trackId);
  const held = tx.select().from(dislikes).where(eq(dislikes.songKey, songKey)).get();
  if (held !== undefined && !wins(row, held)) return false;
  if (row.deleted) {
    // A removal of a dislike this phone never had has nothing to remove.
    if (held === undefined) return false;
    tx.update(dislikes)
      .set({ ...stamp(row), pushed: true })
      .where(eq(dislikes.songKey, songKey))
      .run();
    return true;
  }
  const values = {
    title: row.title,
    artists: row.artists,
    durationMs: row.durationMs,
    dislikedAt: row.dislikedAt,
    ...stamp(row),
    pushed: true,
  };
  tx.insert(dislikes)
    .values({ songKey, ...values })
    .onConflictDoUpdate({ target: dislikes.songKey, set: values })
    .run();
  return true;
};

/**
 * Settles the songs a pull left both starred and disliked (a star set on
 * one device, a dislike on another): the later mark stays (Core's
 * `settleMarks`), and the other is removed with a stamp every device gives
 * it alike, which goes up with the next push. A YT Music song's dislike
 * meets the star of the Track downloaded from its video.
 */
const settlePulledMarks = (tx: LibraryDatabase, changed: Changed): void => {
  if (!changed.favorites && !changed.dislikes) return;
  const { dislikes, favorites, tracks } = schema;
  const pair = {
    songKey: dislikes.songKey,
    trackId: favorites.trackId,
    dislikedAt: dislikes.changedAt,
    dislikedBy: dislikes.phoneId,
    starredAt: favorites.changedAt,
    starredBy: favorites.phoneId,
  };
  const bothLive = and(eq(dislikes.deleted, false), eq(favorites.deleted, false));
  const both = [
    ...tx
      .select(pair)
      .from(dislikes)
      .innerJoin(favorites, sql`${favorites.trackId} = CAST(${dislikes.songKey} AS INTEGER)`)
      .where(and(bothLive, notLike(dislikes.songKey, YT_DISLIKES)))
      .all(),
    ...tx
      .select(pair)
      .from(favorites)
      .innerJoin(tracks, eq(tracks.id, favorites.trackId))
      .innerJoin(dislikes, sql`${dislikes.songKey} = 'yt:' || ${tracks.videoId}`)
      .where(and(bothLive, isNotNull(tracks.videoId)))
      .all(),
  ];
  for (const marks of both) {
    const { removed, removal } = settleMarks(
      { changedAt: marks.starredAt, phoneId: marks.starredBy },
      { changedAt: marks.dislikedAt, phoneId: marks.dislikedBy },
    );
    const values = { ...removal, deleted: true, pushed: false };
    if (removed === "favorite") {
      tx.update(favorites).set(values).where(eq(favorites.trackId, marks.trackId)).run();
      changed.favorites = true;
    } else {
      tx.update(dislikes).set(values).where(eq(dislikes.songKey, marks.songKey)).run();
      changed.dislikes = true;
    }
  }
};

/** The tables whose synced rows are kept by their id alone, and that id's column. */
type IdTable =
  | { readonly table: typeof schema.follows; readonly field: "key" }
  | { readonly table: typeof schema.hiddenFollowReleases; readonly field: "key" }
  | { readonly table: typeof schema.notifiedFollowShows; readonly field: "id" }
  | { readonly table: typeof schema.dismissedFollowSuggestions; readonly field: "key" };

/**
 * A follow, hidden release, notified show or dismissed follow suggestion:
 * a row kept by its id, with [fields] its own columns (none for a
 * tombstone, which keeps the ones the phone has).
 */
const applyIdRow = (
  tx: LibraryDatabase,
  row: SyncRow,
  into: IdTable,
  fields: Readonly<Record<string, unknown>> = {},
): boolean => {
  const id = into.field === "key" ? into.table.key : into.table.id;
  const held = tx.select().from(into.table).where(eq(id, row.id)).get();
  if (held !== undefined && !wins(row, held)) return false;
  // A removal of a row this phone never had has nothing to remove.
  if (row.deleted && held === undefined) return false;
  const values = { ...fields, ...stamp(row), pushed: true };
  if (held !== undefined) {
    tx.update(into.table).set(values).where(eq(id, row.id)).run();
  } else {
    tx.insert(into.table)
      .values({ [into.field]: row.id, ...values } as typeof into.table.$inferInsert)
      .run();
  }
  return true;
};

/** A follow's columns besides its key; none for an unfollow. */
const followFields = (row: SyncFollow) =>
  row.deleted
    ? {}
    : {
        name: row.name,
        level: row.level,
        followedAt: row.followedAt,
        deezerId: row.deezerId,
        ytBrowseId: row.ytBrowseId,
      };

/** A dismissed follow suggestion's columns besides its key; none for its Undo. */
const dismissalFields = (row: SyncDismissedSuggestion) =>
  row.deleted ? {} : { dismissedAt: row.dismissedAt };

const applyPreference = (
  tx: LibraryDatabase,
  row: SyncPreference,
): { key: string; value: string | null } | null => {
  if (!syncsPreference(row.id)) return null;
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

/**
 * A pulled playlist play's context on this phone. Playlist numbers differ
 * between phones, so the play names its playlist by sync id; one that names
 * none (a Wave from before it did) or a playlist this phone lacks keeps no
 * playlist, and counts for none.
 */
const playlistContext = (tx: LibraryDatabase, row: SyncPlayRow): string | null => {
  if (row.contextPlaylistId == null) return null;
  const playlist = tx
    .select({ id: schema.playlists.id })
    .from(schema.playlists)
    .where(eq(schema.playlists.syncId, row.contextPlaylistId))
    .get();
  return playlist === undefined ? null : String(playlist.id);
};

const applyPlay = (
  tx: LibraryDatabase,
  row: SyncPlayRow,
  trackIds: ReadonlyMap<string, number>,
  split: (credit: string) => readonly string[],
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
  // Keep a stream's video identity even when its file is here, just as a
  // locally recorded stream does. History resolves its current Library song.
  const videoId = row.videoId ?? null;
  const trackId = videoId === null ? trackIds.get(row.songId) : undefined;
  if (trackId === undefined && videoId === null && row.snapshot == null) {
    pend(tx, "plays", row, { songKey: row.songId });
    return false;
  }
  const song =
    trackId === undefined ? undefined : trackQuery(tx).where(eq(schema.tracks.id, trackId)).get();
  const snapshot =
    row.snapshot === null || row.snapshot === undefined
      ? song === undefined
        ? null
        : {
            title: song.title,
            artist: song.artist,
            album: song.album,
            artworkPath: song.artworkPath,
            thumbPath: song.thumbPath,
          }
      : {
          title: row.snapshot.title,
          artist: row.snapshot.artist,
          album: row.snapshot.album,
          artworkPath: null,
          thumbPath: null,
          artworkUrl: remoteCover(row.snapshot.artworkPath) ?? remoteCover(row.snapshot.thumbPath),
        };
  unpend(tx, "plays", row.id);
  tx.insert(playEvents)
    .values({
      trackId: trackId ?? null,
      videoId,
      snapshot,
      streamedSong:
        videoId === null
          ? null
          : {
              videoId,
              title: snapshot?.title ?? UNKNOWN_SONG_TITLE,
              artists: split(snapshot?.artist ?? ""),
              album: snapshot?.album ?? null,
              artworkUrl: snapshot?.artworkUrl ?? null,
              durationMs: row.durationMs,
              explicit: false,
              albumId: null,
            },
      recordingKey: row.songId,
      syncId: row.id,
      startedAt: row.startedAt,
      listenedMs: row.listenedMs,
      durationMs: row.durationMs,
      endReason: row.endReason,
      counted: row.counted,
      contextType: row.contextType,
      contextId: row.contextType === "playlist" ? playlistContext(tx, row) : row.contextId,
      source: row.source,
      importedFrom: row.importedFrom,
      ongoing: false,
      pushed: true,
    })
    .run();
  return true;
};

/** Splits a play's artist credit by the Library's artists (Core's `creditSplitter`). */
type Splitter = (credit: string | readonly string[]) => string[];

/** The Library's artist names, which a pulled play's credit is split by. */
const selectArtistNames = (tx: LibraryDatabase): string[] =>
  tx
    .select({ name: schema.artists.name })
    .from(schema.artists)
    .all()
    .map((row) => row.name);

/** A splitter built from [tx]'s artists the first time a play needs one. */
const splitterOf = (tx: LibraryDatabase): (() => Splitter) => {
  let split: Splitter | null = null;
  return () => (split ??= creditSplitter(selectArtistNames(tx)));
};

const applyRows = (
  tx: LibraryDatabase,
  rows: Pick<SyncTables, "playlistEntries" | "favorites" | "plays" | "dislikes">,
  place: Placing,
  changed: Changed,
  now: number,
  splitter: () => Splitter,
): void => {
  const { trackIds } = place;
  const placed = new Set<number>();
  for (const row of rows.playlistEntries) {
    if (applyEntry(tx, row, place, placed)) changed.playlists = true;
  }
  keepOneEntryPerSong(tx, placed, now);
  for (const row of rows.favorites) {
    if (applyFavorite(tx, row, trackIds)) changed.favorites = true;
  }
  for (const row of rows.dislikes) {
    if (applyDislike(tx, row, trackIds)) changed.dislikes = true;
  }
  settlePulledMarks(tx, changed);
  if (rows.plays.length > 0) {
    const split = splitter();
    for (const row of rows.plays) {
      if (applyPlay(tx, row, trackIds, split)) changed.plays = true;
    }
  }
};

/**
 * Applies a page the account sent: each row merged with the phone's by
 * Core's rules (`mergeRows`, plays by id only), recording keys turned into
 * the phone's Tracks by [trackIds] (`selectAccountTrackIds`). A song left
 * both starred and disliked keeps the later mark (`settleMarks`). Streamed plays
 * and Library plays with snapshots show immediately; other rows whose
 * song or playlist the phone lacks wait in `sync_pending`. A playlist that
 * receives an entry of a song it already holds keeps one of them
 * (`keepOneEntryPerSong`). The page's cursor is kept for the next pull, in
 * the same transaction.
 */
export const applyPulledPage = (
  db: LibraryDatabase,
  page: SyncPullPage,
  trackIds: ReadonlyMap<string, number>,
  now: number,
): PulledChanges =>
  db.transaction((tx) => {
    const changed = applyPulledRows(tx, page, trackIds, now, splitterOf(tx));
    keepCursor(tx, page.cursor);
    return changed;
  });

/** Rows one step of a pulled page's apply applies, in one transaction (#1450). */
const PULLED_AT_ONCE = 25;

/** The recording keys [rows] place their songs by (`selectAccountTrackIds`). */
const songKeys = (rows: SyncTables): string[] => [
  ...rows.playlistEntries.flatMap((row) =>
    "playlistId" in row && row.songId !== null ? [row.songId] : [],
  ),
  ...rows.favorites.map((row) => row.id),
  ...rows.dislikes.map((row) => row.id),
  ...rows.plays.map((row) => row.songId),
];

/**
 * `applyPulledPage` as steps for work that runs in slices (#1450): the page applied
 * `PULLED_AT_ONCE` rows a step (Core's `pullPagePieces`), each piece one transaction that
 * reads only the Tracks its rows name, and the page's cursor kept with the last piece. A sync
 * stopped between pieces pulls the page again; the pieces applied by then merge as no change.
 * [applied] gets what each piece changed once it's committed.
 */
export function* applyPulledPageSteps(
  db: LibraryDatabase,
  page: SyncPullPage,
  now: number,
  applied: (changes: PulledChanges) => void,
): Generator<void, void> {
  let split: Splitter | null = null;
  if (page.plays.length > 0) {
    const names = selectArtistNames(db);
    yield;
    split = yield* creditSplitterSteps(names);
  }
  for (const piece of pullPagePieces(page, PULLED_AT_ONCE)) {
    yield;
    const keys = songKeys(piece.rows);
    const changes = db.transaction((tx) => {
      const trackIds =
        keys.length === 0 ? new Map<string, number>() : selectAccountTrackIds(tx, keys);
      const changed = applyPulledRows(
        tx,
        piece.rows,
        trackIds,
        now,
        () => split ?? splitterOf(tx)(),
      );
      if (piece.cursor !== null) keepCursor(tx, piece.cursor);
      return changed;
    });
    applied(changes);
  }
}

/** Keeps [cursor] for the next pull. */
const keepCursor = (tx: LibraryDatabase, cursor: string): void => {
  tx.update(schema.syncState).set({ cursor }).where(eq(schema.syncState.id, 1)).run();
};

/** Applies pulled [rows] (`applyPulledPage`), the cursor aside. */
const applyPulledRows = (
  tx: LibraryDatabase,
  rows: SyncTables,
  trackIds: ReadonlyMap<string, number>,
  now: number,
  splitter: () => Splitter,
): Changed => {
  const changed = nothingChanged();
  const place = placing(tx, trackIds, rows.playlistEntries);
  for (const row of rows.songs) {
    if (applySong(tx, row)) changed.songs = true;
  }
  for (const row of rows.playlists) {
    if (applyPlaylist(tx, row, now, place)) changed.playlists = true;
  }
  applyRows(tx, rows, place, changed, now, splitter);
  markUnseen(tx, place);
  for (const row of rows.preferences) {
    const applied = applyPreference(tx, row);
    if (applied !== null) changed.preferences.push(applied);
  }
  for (const row of rows.follows) {
    if (applyIdRow(tx, row, { table: schema.follows, field: "key" }, followFields(row))) {
      changed.follows = true;
    }
  }
  for (const row of rows.hiddenReleases) {
    if (applyIdRow(tx, row, { table: schema.hiddenFollowReleases, field: "key" })) {
      changed.follows = true;
    }
  }
  for (const row of rows.notifiedShows) {
    if (applyIdRow(tx, row, { table: schema.notifiedFollowShows, field: "id" })) {
      changed.follows = true;
    }
  }
  for (const row of rows.dismissedSuggestions) {
    const into = { table: schema.dismissedFollowSuggestions, field: "key" } as const;
    if (applyIdRow(tx, row, into, dismissalFields(row))) changed.dismissedSuggestions = true;
  }
  return changed;
};

/** The rows waiting in `sync_pending` whose song and playlist the phone now has. */
const isReady = (tx: LibraryDatabase): SQL | undefined => {
  const { syncPending, tracks, playlists } = schema;
  return and(
    or(
      isNull(syncPending.songKey),
      inArray(syncPending.songKey, tx.select({ key: tracks.recordingKey }).from(tracks)),
      // A collaborative playlist's entry finds its song by its fields, or streams.
      and(
        eq(syncPending.kind, "playlistEntries"),
        inArray(
          sql`json_extract(${syncPending.row}, '$.playlistId')`,
          tx.select({ id: schema.collaborations.playlistSyncId }).from(schema.collaborations),
        ),
      ),
    ),
    or(
      isNull(syncPending.playlistKey),
      inArray(syncPending.playlistKey, tx.select({ key: playlists.syncId }).from(playlists)),
    ),
  );
};

/** The waiting rows [ready], taken out of `sync_pending` and grouped by table. */
const pendingRows = (
  tx: LibraryDatabase,
  ready: readonly { readonly kind: string; readonly id: string; readonly row: string }[],
) => {
  const rows = {
    playlistEntries: [] as SyncPlaylistEntry[],
    favorites: [] as SyncFavorite[],
    plays: [] as SyncPlayRow[],
    dislikes: [] as SyncDislike[],
  };
  for (const row of ready) {
    unpend(tx, row.kind as PendingKind, row.id);
    (rows[row.kind as PendingKind] as unknown[]).push(JSON.parse(row.row));
  }
  return rows;
};

/**
 * Applies the rows waiting in `sync_pending` whose song and playlist the
 * phone now has (a scan found the file, the playlist came in a later page).
 */
export const applyPending = (
  db: LibraryDatabase,
  trackIds: ReadonlyMap<string, number>,
  now: number = Date.now(),
): PulledChanges => {
  const { syncPending } = schema;
  return db.transaction((tx) => {
    const ready = tx.select().from(syncPending).where(isReady(tx)).all();
    const rows = pendingRows(tx, ready);
    const changed = nothingChanged();
    const place = placing(tx, trackIds, rows.playlistEntries);
    applyRows(tx, rows, place, changed, now, splitterOf(tx));
    markUnseen(tx, place);
    // A snapshot-only Library play is already visible; attach it once its
    // account song or file arrives, keeping its play id and display snapshot.
    const detached = tx
      .selectDistinct({ key: schema.playEvents.recordingKey })
      .from(schema.playEvents)
      .where(and(isNull(schema.playEvents.trackId), isNull(schema.playEvents.videoId)))
      .all();
    for (const { key } of detached) {
      const trackId = key === null ? undefined : trackIds.get(key);
      if (trackId === undefined || key === null) continue;
      tx.update(schema.playEvents)
        .set({ trackId })
        .where(
          and(
            eq(schema.playEvents.recordingKey, key),
            isNull(schema.playEvents.trackId),
            isNull(schema.playEvents.videoId),
          ),
        )
        .run();
      changed.plays = true;
    }
    return changed;
  });
};

/** Waiting rows one step of `applyPendingSteps` reads, and how many it applies a step. */
const PENDING_READ_AT_ONCE = 250;
const PENDING_AT_ONCE = 15;
/**
 * Detached plays one step attaches to their songs: fewer, as each one's new song runs the play
 * totals' triggers, which no statement count shows.
 */
const ATTACHED_AT_ONCE = 10;

/**
 * `applyPending` as steps for work that runs in slices (#1450): the ready rows read a few
 * hundred a step in their key's order and applied `PENDING_AT_ONCE` a step, each piece one
 * transaction that reads only the Tracks its rows name; then the detached plays attached the
 * same way. [applied] gets what each piece changed once it's committed.
 */
export function* applyPendingSteps(
  db: LibraryDatabase,
  now: number,
  applied: (changes: PulledChanges) => void,
): Generator<void, void> {
  const { syncPending, playEvents } = schema;
  for (let after: { kind: string; id: string } | null = null; ;) {
    const ready: (typeof syncPending.$inferSelect)[] = db
      .select()
      .from(syncPending)
      .where(
        and(
          isReady(db),
          after === null
            ? undefined
            : sql`(${syncPending.kind}, ${syncPending.id}) > (${after.kind}, ${after.id})`,
        ),
      )
      .orderBy(asc(syncPending.kind), asc(syncPending.id))
      .limit(PENDING_READ_AT_ONCE)
      .all();
    for (let start = 0; start < ready.length; start += PENDING_AT_ONCE) {
      yield;
      const piece = ready.slice(start, start + PENDING_AT_ONCE);
      applied(
        db.transaction((tx) => {
          const rows = pendingRows(tx, piece);
          const changed = nothingChanged();
          const trackIds = selectAccountTrackIds(tx, songKeys({ ...EMPTY_SYNC_TABLES, ...rows }));
          const place = placing(tx, trackIds, rows.playlistEntries);
          applyRows(tx, rows, place, changed, now, splitterOf(tx));
          markUnseen(tx, place);
          return changed;
        }),
      );
    }
    const last: typeof syncPending.$inferSelect | undefined = ready[ready.length - 1];
    if (last === undefined || ready.length < PENDING_READ_AT_ONCE) break;
    after = { kind: last.kind, id: last.id };
    yield;
  }
  // A snapshot-only Library play is already visible; attach it once its
  // account song or file arrives, keeping its play id and display snapshot. Read by play
  // id, so each step touches only the plays it read: a play's key has no index of its own.
  const detachedPlay = and(isNull(playEvents.trackId), isNull(playEvents.videoId));
  for (let after = 0; ;) {
    yield;
    const plays: { id: number; key: string }[] = db
      .select({ id: playEvents.id, key: sql<string>`${playEvents.recordingKey}` })
      .from(playEvents)
      .where(and(detachedPlay, isNotNull(playEvents.recordingKey), gt(playEvents.id, after)))
      .orderBy(asc(playEvents.id))
      .limit(PENDING_READ_AT_ONCE)
      .all();
    yield;
    const trackIds =
      plays.length === 0
        ? new Map<string, number>()
        : selectAccountTrackIds(db, [...new Set(plays.map((play) => play.key))]);
    const placed = plays.flatMap(({ id, key }) => {
      const trackId = trackIds.get(key);
      return trackId === undefined ? [] : [{ id, trackId }];
    });
    for (let start = 0; start < placed.length; start += ATTACHED_AT_ONCE) {
      yield;
      db.transaction((tx) => {
        for (const { id, trackId } of placed.slice(start, start + ATTACHED_AT_ONCE)) {
          tx.update(playEvents)
            .set({ trackId })
            .where(and(eq(playEvents.id, id), detachedPlay))
            .run();
        }
      });
      applied({ ...nothingChanged(), plays: true });
    }
    const last: { id: number } | undefined = plays[plays.length - 1];
    if (last === undefined || plays.length < PENDING_READ_AT_ONCE) return;
    after = last.id;
  }
}

/** What a page of a member's pull of one collaborative playlist did here. */
export interface PlaylistPageResult {
  /** The playlist or its entries changed. */
  readonly changed: boolean;
  /** The page holds the owner's deletion of the playlist: nothing was applied. */
  readonly deleted: boolean;
}

/**
 * Applies a page of a member's pull of the collaborative playlist [playlistSyncId]: its row
 * and entries merged as an account page's are, a Library entry matched to this device's
 * Tracks by its fields (`placeLibraryEntry`), and the page's cursor kept as the playlist's
 * own, in the same transaction. Once the playlist is here, the entries an earlier page left
 * waiting for its row (`sync_pending`) are placed with the page's. It reads only the Tracks
 * those entries name or could match. A page that deletes the playlist applies nothing: the
 * caller keeps it as the member's private copy.
 */
export const applyPlaylistPage = (
  db: LibraryDatabase,
  playlistSyncId: string,
  page: SyncPullPage,
  now: number,
): PlaylistPageResult =>
  db.transaction((tx) => {
    const { playlists, syncPending } = schema;
    const own = page.playlists.filter((row) => row.id === playlistSyncId);
    if (own.some((row) => row.deleted)) return { changed: false, deleted: true };
    const pulled = page.playlistEntries.filter(
      (row) => !("playlistId" in row) || row.playlistId === playlistSyncId,
    );
    const changed = nothingChanged();
    // Entries an earlier page left waiting for the playlist's row (`sync_pending`).
    const waiting = tx
      .select({ id: syncPending.id, row: syncPending.row })
      .from(syncPending)
      .where(
        and(eq(syncPending.kind, "playlistEntries"), eq(syncPending.playlistKey, playlistSyncId)),
      )
      .all()
      .map((row) => JSON.parse(row.row) as SyncPlaylistEntry);
    const named = [...waiting, ...pulled];
    // Placed before the playlist's row, so a playlist new here isn't marked changed elsewhere.
    const place = placing(
      tx,
      selectAccountTrackIds(
        tx,
        libraryEntries(named).map((entry) => entry.songId),
      ),
      named,
    );
    for (const row of own) {
      if (applyPlaylist(tx, row, now, place)) changed.playlists = true;
    }
    const here =
      tx
        .select({ id: playlists.id })
        .from(playlists)
        .where(eq(playlists.syncId, playlistSyncId))
        .get() !== undefined;
    const ready = here ? waiting : [];
    for (const row of ready) unpend(tx, "playlistEntries", row.id);
    const entries = [...ready, ...pulled];
    applyRows(
      tx,
      { playlistEntries: entries, favorites: [], plays: [], dislikes: [] },
      place,
      changed,
      now,
      splitterOf(tx),
    );
    markUnseen(tx, place);
    tx.update(schema.collaborations)
      .set({ cursor: page.cursor })
      .where(eq(schema.collaborations.playlistSyncId, playlistSyncId))
      .run();
    return { changed: changed.playlists, deleted: false };
  });
