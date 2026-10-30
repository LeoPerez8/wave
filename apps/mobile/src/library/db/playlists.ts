/**
 * The playlist rows the playlist screen and Auto's playlists read, and the
 * edits to what a playlist holds. A playlist holds Library tracks and YT
 * Music songs the Library doesn't have (Core's `PlaylistSong`), side by side.
 * Kept free of Expo so the store tests run them against a real SQLite
 * (`testDatabase.ts`).
 */
import {
  checkPlaylistName,
  compareStrings,
  placeEntries,
  planPlaylistSongs,
  planShazamAdd,
  playlistArtwork,
  playlistEntryLinks,
  playlistMosaic,
  readPlaylistEntrySong,
  sortKey,
  tryAgainSettles,
  unsearchedSettles,
  unsearchedTrackId,
  writePlaylistEntrySong,
  type AppLanguage,
  type OrderedEntry,
  type PlaylistItem,
  type PlaylistSong,
  type StoredPlaylistSong,
  type TryAgainAnswered,
  type UnsearchedSong,
  type YtAlbumSong,
} from "@wave/core";
import { and, asc, desc, eq, inArray, isNotNull, isNull, ne, or, sql, type SQL } from "drizzle-orm";

import type { PlaylistAddResult, PlaylistDetail, PlaylistRow } from "../LibraryStore.ts";
import type { LibraryDatabase, RowPage } from "./database.ts";
import {
  countAppend,
  countDecoded,
  countListRead,
  countPageRead,
  countSummarized,
} from "./playlistWork.ts";
import * as schema from "./schema.ts";
import { stamped } from "./sync.ts";
import { filePath, hasFile, inScope, songColumns, type TrackScope } from "./tracks.ts";

/** Playlist order: by order key, then by entry id for entries two phones gave one key (Core's `compareOrderKeys`). */
const IN_ORDER = [asc(schema.playlistItems.orderKey), asc(schema.playlistItems.syncId)] as const;

/** Entries the playlist holds: not removed (tombstones). */
const live = eq(schema.playlistItems.deleted, false);

/** A song a playlist stores in `yt_song`: a YT Music song it streams, an unsearched song, or an unavailable one. */
type StoredSong = StoredPlaylistSong;

/**
 * [playlistId]'s stored song [stored] (Core's `readPlaylistEntrySong`): a YT
 * Music song, an unsearched one or an unavailable one, counted as decoded.
 */
const decode = (playlistId: number, stored: string): StoredSong | null => {
  countDecoded(playlistId);
  return readPlaylistEntrySong(stored);
};

/** A playlist's Library tracks in [scope] with their playlist item. */
const playlistTracks = (
  db: LibraryDatabase,
  playlistId: number,
  itemIds: readonly number[] | undefined,
  scope: TrackScope,
) => {
  const { playlistItems, tracks, artists, albums, artwork } = schema;
  return db
    .select({ ...songColumns, itemId: playlistItems.id })
    .from(playlistItems)
    .innerJoin(tracks, inScope(eq(playlistItems.trackId, tracks.id), scope))
    .innerJoin(artists, eq(tracks.artistId, artists.id))
    .innerJoin(albums, eq(tracks.albumId, albums.id))
    .leftJoin(artwork, eq(tracks.artworkHash, artwork.hash))
    .where(
      and(
        eq(playlistItems.playlistId, playlistId),
        live,
        itemIds === undefined ? undefined : inArray(playlistItems.id, [...itemIds]),
      ),
    )
    .all();
};

/** A Library track as a playlist lists it. */
export type PlaylistTrack = Omit<ReturnType<typeof playlistTracks>[number], "itemId">;

/**
 * One entry of a playlist, in its place (`itemId`; the same song may be in it
 * more than once): a Library track, a YT Music song streamed, or a song an
 * import couldn't find (unavailable).
 */
export type PlaylistEntry<T = PlaylistTrack> = PlaylistItem<YtAlbumSong, T> & {
  readonly itemId: number;
};

/** A stored song as decoded, and the entry's stamp when it was. */
interface DecodedSong {
  readonly changedAt: number;
  readonly song: StoredSong | null;
}

/**
 * Per database, the stored songs of the playlist last read whole, by entry:
 * read again (an import filling it, its page in sight), only entries added
 * or changed since are decoded. A streamed entry's song is written once,
 * when it's added, and an entry that changes is stamped (`changed_at`) or,
 * unstamped, first becomes a Library song (signing out), which drops it from
 * here. One playlist's at a time, the songs its page shows anyway.
 */
const decodedSongs = new WeakMap<
  LibraryDatabase,
  { readonly playlistId: number; readonly songs: Map<number, DecodedSong> }
>();

/**
 * The stored songs of [playlistId]'s entries [streamed] (in [whole] reads,
 * every one it holds), decoded or, for a [whole] read, as decoded before.
 */
const streamedSongs = (
  db: LibraryDatabase,
  playlistId: number,
  streamed: readonly { readonly id: number; readonly changedAt: number }[],
  whole: boolean,
): Map<number, DecodedSong> => {
  const known = whole ? decodedSongs.get(db) : undefined;
  const before = known?.playlistId === playlistId ? known.songs : undefined;
  const songs = new Map<number, DecodedSong>();
  const missing: number[] = [];
  for (const { id, changedAt } of streamed) {
    const decoded = before?.get(id);
    if (decoded !== undefined && decoded.changedAt === changedAt) songs.set(id, decoded);
    else missing.push(id);
  }
  const { playlistItems } = schema;
  for (let i = 0; i < missing.length; i += LOOKUP_CHUNK) {
    const rows = db
      .select({
        id: playlistItems.id,
        changedAt: playlistItems.changedAt,
        ytSong: sql<string>`${playlistItems.ytSong}`,
      })
      .from(playlistItems)
      .where(
        and(
          sql`${playlistItems.id} IN ${jsonList(missing.slice(i, i + LOOKUP_CHUNK))}`,
          isNotNull(playlistItems.ytSong),
        ),
      )
      .all();
    for (const row of rows) {
      songs.set(row.id, { changedAt: row.changedAt, song: decode(playlistId, row.ytSong) });
    }
  }
  if (whole) decodedSongs.set(db, { playlistId, songs });
  return songs;
};

/** Entry ids per lookup of their stored songs. */
const LOOKUP_CHUNK = 2_000;

/**
 * A playlist's entries in playlist order, [page] of them if given: its YT
 * Music entries, its unavailable entries and its Library tracks in [scope]
 * (Android Auto's: only what can play, the tracks with a file and no
 * unavailable entry). An entry whose stored song can't be read is left out.
 * Reading the whole playlist again decodes only the stored songs added or
 * changed since (`streamedSongs`).
 */
export const selectPlaylistEntries = (
  db: LibraryDatabase,
  playlistId: number,
  page?: RowPage,
  scope: TrackScope = "library",
): PlaylistEntry[] => {
  const { playlistItems } = schema;
  const query = db
    .select({
      id: playlistItems.id,
      changedAt: playlistItems.changedAt,
      streamed: sql<number>`${playlistItems.ytSong} IS NOT NULL`,
    })
    .from(playlistItems)
    .where(
      and(
        eq(playlistItems.playlistId, playlistId),
        live,
        scope === "files"
          ? or(
              and(isNull(playlistItems.trackId), sql`NOT ${storedUnavailable}`),
              inArray(
                playlistItems.trackId,
                db.select({ id: schema.tracks.id }).from(schema.tracks).where(hasFile),
              ),
            )
          : undefined,
      ),
    )
    .orderBy(...IN_ORDER);
  const items =
    page === undefined ? query.all() : query.limit(page.limit).offset(page.offset).all();
  const songs = streamedSongs(
    db,
    playlistId,
    items.filter((item) => item.streamed),
    page === undefined,
  );
  if (items.length === 0) return [];
  // A page reads only its own tracks; the whole list, the playlist's.
  const tracks = new Map(
    playlistTracks(
      db,
      playlistId,
      page === undefined ? undefined : items.map((item) => item.id),
      scope,
    ).map(({ itemId, ...track }) => [itemId, track]),
  );
  return items.flatMap((item): PlaylistEntry[] => {
    if (item.streamed) {
      const stored = songs.get(item.id)?.song ?? null;
      return stored === null ? [] : [{ itemId: item.id, ...stored }];
    }
    const track = tracks.get(item.id);
    return track === undefined ? [] : [{ itemId: item.id, source: "library", track }];
  });
};

/**
 * Every track's id and file path, for matching an imported playlist's
 * entries (Core's `libraryPathIndex`); missing songs have no file to match.
 */
export const selectTrackPaths = (db: LibraryDatabase) =>
  db.select({ id: schema.tracks.id, path: filePath }).from(schema.tracks).where(hasFile).all();

/** Rows per insert, well under SQLite's limit on bound values. */
const INSERT_CHUNK = 200;

/** Inserts playlist entries [rows] (any number), in inserts of a size SQLite takes. */
const insertPlaylistItems = (
  db: LibraryDatabase,
  rows: readonly (typeof schema.playlistItems.$inferInsert)[],
): void => {
  for (let i = 0; i < rows.length; i += INSERT_CHUNK) {
    db.insert(schema.playlistItems)
      .values(rows.slice(i, i + INSERT_CHUNK))
      .run();
  }
};

/**
 * A playlist's entries as their order sees them (`id`: the entry's sync id),
 * with their row id, in playlist order.
 */
const orderedEntries = (
  db: LibraryDatabase,
  playlistId: number,
): (OrderedEntry & { readonly itemId: number })[] => {
  const { playlistItems } = schema;
  return db
    .select({
      itemId: playlistItems.id,
      id: playlistItems.syncId,
      orderKey: playlistItems.orderKey,
    })
    .from(playlistItems)
    .where(and(eq(playlistItems.playlistId, playlistId), live))
    .orderBy(...IN_ORDER)
    .all();
};

/** Gives entries their new keys (`placeEntries`' `rekeyed`), stamping each. */
const rekey = (db: LibraryDatabase, rekeyed: readonly OrderedEntry[], now: number): void => {
  const { playlistItems } = schema;
  for (const entry of rekeyed) {
    db.update(playlistItems)
      .set({ orderKey: entry.orderKey, ...stamped(playlistItems, now) })
      .where(eq(playlistItems.syncId, entry.id))
      .run();
  }
};

/**
 * Inserts [songs] as entries of a playlist at [index] of its [entries], in
 * the order given, each with its order key (Core's `placeEntries`).
 */
const placeSongs = (
  db: LibraryDatabase,
  playlistId: number,
  entries: readonly OrderedEntry[],
  index: number,
  songs: readonly PlaylistSong[],
  now: number,
): void => {
  if (songs.length === 0) return;
  const { keys, rekeyed } = placeEntries(entries, index, songs.length);
  rekey(db, rekeyed, now);
  insertPlaylistItems(
    db,
    songs.map((song, i) => ({
      playlistId,
      trackId: song.source === "library" ? song.trackId : null,
      ytSong: song.source === "library" ? null : writePlaylistEntrySong(song),
      orderKey: keys[i] ?? "",
      addedAt: now,
      changedAt: now,
    })),
  );
};

/** A stored YT Music song's video id, read by SQLite through its index; null for one that isn't JSON. */
const storedVideoId = schema.videoIdIn(schema.playlistItems.ytSong);

/** Whether the entry is an unavailable song, as Core's `writePlaylistEntrySong` marks it. */
const storedUnavailable = sql`(CASE WHEN json_valid(${schema.playlistItems.ytSong})
  THEN json_type(${schema.playlistItems.ytSong}, '$.unavailable') END IS NOT NULL)`;

/** A stored unavailable song's title, read by SQLite; null for any other entry. */
const storedUnavailableTitle = sql`CASE WHEN ${storedUnavailable}
  THEN json_extract(${schema.playlistItems.ytSong}, '$.title') END`;

/** Whether the entry is an unsearched song, as Core's `writePlaylistEntrySong` marks it. */
const storedUnsearched = schema.unsearchedSongIn(schema.playlistItems.ytSong);

/** A stored unsearched song's title, read by SQLite through its index; null for any other entry. */
const storedUnsearchedTitle = schema.unsearchedTitleIn(schema.playlistItems.ytSong);

/** [values] as one bound value that SQLite reads back as a list: `x IN ${jsonList(values)}`. */
const jsonList = (values: readonly (string | number)[]) =>
  sql`(SELECT value FROM json_each(${JSON.stringify(values)}))`;

/**
 * What a playlist holds of [songs], as Core's `planPlaylistSongs` compares
 * them: its Library tracks among them, its YT Music songs with their video
 * ids, and its unavailable songs with their titles. SQLite finds the candidates, so only the stored songs a batch
 * could repeat are decoded, not the whole playlist; decoding them checks each
 * is readable, as the playlist's list reads it.
 */
const heldAmong = (
  db: LibraryDatabase,
  playlistId: number,
  songs: readonly PlaylistSong[],
): PlaylistSong[] => {
  const { playlistItems } = schema;
  const trackIds: number[] = [];
  const videoIds: string[] = [];
  const unavailableTitles: string[] = [];
  const unsearchedTitles: string[] = [];
  for (const song of songs) {
    if (song.source === "library") trackIds.push(song.trackId);
    else if (song.source === "stream") videoIds.push(song.song.videoId);
    else if (song.source === "unsearched") unsearchedTitles.push(song.song.title);
    else unavailableTitles.push(song.song.title);
  }
  const inPlaylist = and(eq(playlistItems.playlistId, playlistId), live);
  const held: PlaylistSong[] = [];
  if (trackIds.length > 0) {
    const rows = db
      .select({ trackId: sql<number>`${playlistItems.trackId}` })
      .from(playlistItems)
      .where(and(inPlaylist, sql`${playlistItems.trackId} IN ${jsonList(trackIds)}`))
      .all();
    for (const { trackId } of rows) held.push({ source: "library", trackId });
  }
  if (videoIds.length > 0) {
    const rows = db
      .select({ ytSong: sql<string>`${playlistItems.ytSong}` })
      .from(playlistItems)
      .where(
        and(
          inPlaylist,
          isNotNull(playlistItems.ytSong),
          sql`${storedVideoId} IN ${jsonList(videoIds)}`,
        ),
      )
      .all();
    for (const { ytSong } of rows) {
      const song = decode(playlistId, ytSong);
      if (song !== null) held.push(song);
    }
  }
  for (const [stored, titles] of [
    [storedUnavailableTitle, unavailableTitles],
    [storedUnsearchedTitle, unsearchedTitles],
  ] as const) {
    if (titles.length === 0) continue;
    const rows = db
      .select({ ytSong: sql<string>`${playlistItems.ytSong}` })
      .from(playlistItems)
      .where(and(inPlaylist, sql`${stored} IN ${jsonList(titles)}`))
      .all();
    for (const { ytSong } of rows) {
      const song = decode(playlistId, ytSong);
      if (song !== null) held.push(song);
    }
  }
  return held;
};

/** A playlist's last entry in playlist order, which an append goes after; null when it's empty. */
const lastEntry = (db: LibraryDatabase, playlistId: number): OrderedEntry | null => {
  const { playlistItems } = schema;
  return (
    db
      .select({ id: playlistItems.syncId, orderKey: playlistItems.orderKey })
      .from(playlistItems)
      .where(and(eq(playlistItems.playlistId, playlistId), live))
      .orderBy(desc(playlistItems.orderKey), desc(playlistItems.syncId))
      .limit(1)
      .get() ?? null
  );
};

/**
 * Appends [songs] to a playlist, Library tracks and YT Music songs alike,
 * except those it already holds (Core's `planPlaylistSongs`); returns how many
 * went in and how many were skipped. Run it inside the caller's transaction.
 */
export const appendPlaylistSongs = (
  db: LibraryDatabase,
  playlistId: number,
  songs: readonly PlaylistSong[],
  now: number,
): { readonly added: number; readonly alreadyIn: number } => {
  countAppend(playlistId);
  if (songs.length === 0) return { added: 0, alreadyIn: 0 };
  const plan = planPlaylistSongs(heldAmong(db, playlistId, songs), songs);
  // At the end, the new keys only depend on the last entry's (Core's `placeEntries`).
  const last = lastEntry(db, playlistId);
  const entries = last === null ? [] : [last];
  placeSongs(db, playlistId, entries, entries.length, plan.add, now);
  return { added: plan.add.length, alreadyIn: plan.alreadyIn };
};

/** Removes the entries [itemIds] of a playlist (all of them if not given), leaving tombstones. */
const tombstoneEntries = (
  db: LibraryDatabase,
  playlistId: number,
  itemIds: readonly number[] | undefined,
  now: number,
): void => {
  const { playlistItems } = schema;
  db.update(playlistItems)
    .set({ deleted: true, ...stamped(playlistItems, now) })
    .where(
      and(
        eq(playlistItems.playlistId, playlistId),
        live,
        itemIds === undefined ? undefined : inArray(playlistItems.id, [...itemIds]),
      ),
    )
    .run();
};

/**
 * Makes a playlist hold exactly [songs], in that order (an import's
 * Replace): the same playlist, so its name and place stay. The entries it
 * held are removed (tombstones).
 */
export const replacePlaylistSongs = (
  db: LibraryDatabase,
  playlistId: number,
  songs: readonly PlaylistSong[],
  now: number,
): void => {
  db.transaction((tx) => {
    const { playlists } = schema;
    tombstoneEntries(tx, playlistId, undefined, now);
    placeSongs(tx, playlistId, [], 0, songs, now);
    tx.update(playlists).set({ updatedAt: now }).where(eq(playlists.id, playlistId)).run();
  });
};

/**
 * Removes the given entries from a playlist in one go (each entry on its own,
 * so another copy of the same song stays), leaving tombstones; ids from other
 * playlists are ignored.
 */
/** An operation's exact tombstones, kept only for its action toast's lifetime. */
export interface PlaylistRemoval {
  readonly playlistId: number;
  /** Entries left in place: existing repeats must remain distinguishable from later additions. */
  readonly retainedItemIds: readonly number[];
  readonly entries: readonly { readonly itemId: number; readonly changedAt: number }[];
}

export const removePlaylistItems = (
  db: LibraryDatabase,
  playlistId: number,
  itemIds: readonly number[],
  now: number,
): PlaylistRemoval =>
  db.transaction((tx) => {
    const { playlists, playlistItems } = schema;
    const entries: { itemId: number; changedAt: number }[] = [];
    for (let i = 0; i < itemIds.length; i += INSERT_CHUNK) {
      entries.push(
        ...tx
          .update(playlistItems)
          .set({ deleted: true, ...stamped(playlistItems, now) })
          .where(
            and(
              eq(playlistItems.playlistId, playlistId),
              live,
              inArray(playlistItems.id, itemIds.slice(i, i + INSERT_CHUNK)),
            ),
          )
          .returning({ itemId: playlistItems.id, changedAt: playlistItems.changedAt })
          .all(),
      );
    }
    if (entries.length > 0)
      tx.update(playlists).set({ updatedAt: now }).where(eq(playlists.id, playlistId)).run();
    const retainedItemIds = tx
      .select({ id: playlistItems.id })
      .from(playlistItems)
      .where(and(eq(playlistItems.playlistId, playlistId), live))
      .all()
      .map((row) => row.id);
    return { playlistId, entries, retainedItemIds };
  });

/** Restores only this operation's still-unchanged tombstones, at their retained order keys. */
export const restorePlaylistItems = (
  db: LibraryDatabase,
  removal: PlaylistRemoval,
  now: number,
): void => {
  db.transaction((tx) => {
    const { playlistItems } = schema;
    const { playlistId } = removal;
    const playlist = tx
      .select({ id: schema.playlists.id })
      .from(schema.playlists)
      .where(and(eq(schema.playlists.id, playlistId), eq(schema.playlists.deleted, false)))
      .get();
    if (playlist === undefined) return;
    const retained = new Set(removal.retainedItemIds);
    const held: PlaylistSong[] = selectPlaylistEntries(tx, playlistId)
      .filter((entry) => !retained.has(entry.itemId))
      .map((entry) =>
        entry.source === "library" ? { source: "library", trackId: entry.track.id } : entry,
      );
    for (const { itemId, changedAt } of removal.entries) {
      const row = tx
        .select()
        .from(playlistItems)
        .where(
          and(
            eq(playlistItems.id, itemId),
            eq(playlistItems.playlistId, playlistId),
            eq(playlistItems.deleted, true),
            eq(playlistItems.changedAt, changedAt),
          ),
        )
        .get();
      if (row === undefined) continue;
      const song: PlaylistSong | null =
        row.trackId !== null
          ? { source: "library", trackId: row.trackId }
          : row.ytSong === null
            ? null
            : decode(playlistId, row.ytSong);
      if (song === null || planPlaylistSongs(held, [song]).add.length === 0) continue;
      tx.update(playlistItems)
        .set({ deleted: false, ...stamped(playlistItems, now) })
        .where(eq(playlistItems.id, itemId))
        .run();
    }
    // A streamed entry may have downloaded while the toast was showing.
    linkPlaylistEntries(tx, now);
    tx.update(schema.playlists)
      .set({ updatedAt: now })
      .where(eq(schema.playlists.id, playlistId))
      .run();
  });
};

/**
 * Moves an entry to [toIndex] (0-based, clamped) in its playlist: only its
 * order key changes (Core's `placeEntries`), and those of entries two phones
 * gave one key when it lands between them.
 */
export const movePlaylistItem = (
  db: LibraryDatabase,
  playlistId: number,
  itemId: number,
  toIndex: number,
  now: number,
): void =>
  db.transaction((tx) => {
    const { playlists, playlistItems } = schema;
    const entries = orderedEntries(tx, playlistId);
    if (!entries.some((entry) => entry.itemId === itemId)) return;
    const others = entries.filter((entry) => entry.itemId !== itemId);
    const { keys, rekeyed } = placeEntries(others, toIndex, 1);
    rekey(tx, rekeyed, now);
    tx.update(playlistItems)
      .set({ orderKey: keys[0] ?? "", ...stamped(playlistItems, now) })
      .where(eq(playlistItems.id, itemId))
      .run();
    tx.update(playlists).set({ updatedAt: now }).where(eq(playlists.id, playlistId)).run();
  });

/** Track ids per query, well under SQLite's limit on bound values. */
const LINK_CHUNK = 500;

/**
 * A number that rises whenever any playlist's entries are written (here,
 * by a sync, by an import, by a link), from `playlist_revisions`: a scan
 * reads it to tell whether entries came that a link hasn't seen.
 */
export const selectPlaylistEntriesRevision = (db: LibraryDatabase): number =>
  db
    .select({ sum: sql<number>`coalesce(sum(${schema.playlistRevisions.revision}), 0)` })
    .from(schema.playlistRevisions)
    .where(ne(schema.playlistRevisions.playlistId, LIBRARY_REVISION))
    .get()?.sum ?? 0;

/**
 * Turns the YT Music and unavailable entries of every playlist that the
 * Library tracks [trackIds] (just downloaded; the whole Library when not
 * given, as a scan does once it ends) positively are (Core's
 * `playlistEntryLinks`) into those tracks, in the same place; an entry whose
 * track its playlist already holds is removed instead (a tombstone). Each
 * change is stamped at [now]. Returns how many entries it changed. Does
 * nothing (one small query) while no playlist holds such an entry. Run it
 * inside the caller's transaction.
 */
export const linkPlaylistEntries = (
  db: LibraryDatabase,
  now: number,
  trackIds?: readonly number[],
): number => {
  const { playlistItems, tracks } = schema;
  if (trackIds?.length === 0) return 0;
  const anyEntry = db
    .select({ id: playlistItems.id })
    .from(playlistItems)
    .where(and(isNotNull(playlistItems.ytSong), live))
    .limit(1)
    .get();
  if (anyEntry === undefined) return 0;
  const entries = db
    .select({
      itemId: playlistItems.id,
      playlistId: playlistItems.playlistId,
      ytSong: playlistItems.ytSong,
    })
    .from(playlistItems)
    .where(and(isNotNull(playlistItems.ytSong), live))
    .orderBy(asc(playlistItems.playlistId), ...IN_ORDER)
    .all()
    .flatMap(({ itemId, playlistId, ytSong }) => {
      const stored = ytSong === null ? null : decode(playlistId, ytSong);
      return stored === null ? [] : [{ itemId, playlistId, song: stored.song }];
    });
  if (entries.length === 0) return 0;
  const columns = {
    id: tracks.id,
    title: tracks.title,
    artist: tracks.artistCredit,
    durationMs: tracks.durationMs,
  };
  // Only songs with a file: a missing song isn't the Library having the song.
  const library: { id: number; title: string; artist: string; durationMs: number }[] =
    trackIds === undefined ? db.select(columns).from(tracks).where(hasFile).all() : [];
  for (let i = 0; trackIds !== undefined && i < trackIds.length; i += LINK_CHUNK) {
    library.push(
      ...db
        .select(columns)
        .from(tracks)
        .where(and(inArray(tracks.id, trackIds.slice(i, i + LINK_CHUNK)), hasFile))
        .all(),
    );
  }
  const held = db
    .select({ playlistId: playlistItems.playlistId, trackId: playlistItems.trackId })
    .from(playlistItems)
    .where(
      and(
        isNotNull(playlistItems.trackId),
        live,
        inArray(playlistItems.playlistId, [...new Set(entries.map((entry) => entry.playlistId))]),
      ),
    )
    .all()
    .flatMap(({ playlistId, trackId }) => (trackId === null ? [] : [{ playlistId, trackId }]));
  const { links, drops } = playlistEntryLinks(entries, library, held);
  for (const { itemId, trackId } of links) {
    db.update(playlistItems)
      .set({ trackId, ytSong: null, ...stamped(playlistItems, now) })
      .where(and(eq(playlistItems.id, itemId), isNull(playlistItems.trackId)))
      .run();
  }
  for (let i = 0; i < drops.length; i += LINK_CHUNK) {
    db.update(playlistItems)
      .set({ deleted: true, ...stamped(playlistItems, now) })
      .where(inArray(playlistItems.id, drops.slice(i, i + LINK_CHUNK)))
      .run();
  }
  return links.length + drops.length;
};

/**
 * Settles what Try Again's [answered] searches found in [playlistId] (Core's
 * `tryAgainSettles`): each unavailable entry found becomes its YT Music song
 * in its place, and one found as a song the playlist already holds is
 * removed (a tombstone). Entries no longer unavailable (removed, or the
 * Library's song meanwhile) are left as they are. Each change is stamped at
 * [now]. Returns how many were found and how many searches failed.
 */
export const settleTryAgain = (
  db: LibraryDatabase,
  playlistId: number,
  answered: readonly TryAgainAnswered<YtAlbumSong>[],
  now: number,
): { readonly found: number; readonly failed: number } =>
  db.transaction((tx) => {
    const { playlists, playlistItems } = schema;
    // What the playlist holds of the songs found, so none goes in twice.
    const candidates = tryAgainSettles(answered, []).replace.map(({ song }): PlaylistSong => ({
      source: "stream",
      song,
    }));
    const { replace, drops, found, failed } = tryAgainSettles(
      answered,
      heldAmong(tx, playlistId, candidates),
    );
    const stillUnavailable = (itemId: number) =>
      and(
        eq(playlistItems.id, itemId),
        eq(playlistItems.playlistId, playlistId),
        live,
        storedUnavailable,
      );
    for (const { itemId, song } of replace) {
      tx.update(playlistItems)
        .set({
          ytSong: writePlaylistEntrySong({ source: "stream", song }),
          ...stamped(playlistItems, now),
        })
        .where(stillUnavailable(itemId))
        .run();
    }
    for (const itemId of drops) {
      tx.update(playlistItems)
        .set({ deleted: true, ...stamped(playlistItems, now) })
        .where(stillUnavailable(itemId))
        .run();
    }
    if (replace.length + drops.length > 0)
      tx.update(playlists).set({ updatedAt: now }).where(eq(playlists.id, playlistId)).run();
    return { found, failed };
  });

/**
 * Settles the unsearched song [song] as [becomes] (Core's `settleUnsearched`:
 * the YT Music song found, or the unavailable song not found) in every
 * playlist that holds it: each entry holding it (by what Spotify listed,
 * `unsearchedTrackId`) becomes that song in its place, or, in a playlist
 * that holds the song already, is removed (Core's `unsearchedSettles`).
 * Each change is stamped at [now], so the Wave account carries it to the
 * other phones. Returns how many entries were rewritten and removed, and
 * the playlists that held it.
 */
export const settleUnsearchedEntries = (
  db: LibraryDatabase,
  song: UnsearchedSong,
  becomes: PlaylistSong,
  now: number,
): UnsearchedEntriesSettled =>
  db.transaction((tx) => {
    const { playlists, playlistItems } = schema;
    const key = unsearchedTrackId(song);
    const holders = tx
      .select({
        itemId: playlistItems.id,
        playlistId: playlistItems.playlistId,
        ytSong: sql<string>`${playlistItems.ytSong}`,
      })
      .from(playlistItems)
      .where(and(live, sql`${storedUnsearchedTitle} = ${song.title}`))
      .orderBy(asc(playlistItems.playlistId), ...IN_ORDER)
      .all()
      .flatMap(({ itemId, playlistId, ytSong }) => {
        const stored = decode(playlistId, ytSong);
        return stored?.source === "unsearched" && unsearchedTrackId(stored.song) === key
          ? [{ itemId, playlistId, listed: stored.song }]
          : [];
      });
    if (holders.length === 0) return { rewritten: 0, removed: 0, playlistIds: [] };
    const playlistIds = [...new Set(holders.map((holder) => holder.playlistId))];
    const held = playlistIds.flatMap((playlistId) =>
      heldAmong(tx, playlistId, [becomes]).map((heldSong) => ({ playlistId, song: heldSong })),
    );
    const { rewrites, drops } = unsearchedSettles(holders, becomes, held);
    const listedBy = new Map(holders.map((holder) => [holder.itemId, holder.listed]));
    for (const itemId of rewrites) {
      // Not found, each entry keeps what its own listing kept (Spotify's cover with it).
      const listed = listedBy.get(itemId);
      const entry: PlaylistSong =
        becomes.source === "unavailable" && listed !== undefined
          ? { source: "unavailable", song: { ...listed, reason: becomes.song.reason } }
          : becomes;
      tx.update(playlistItems)
        .set({
          trackId: entry.source === "library" ? entry.trackId : null,
          ytSong: entry.source === "library" ? null : writePlaylistEntrySong(entry),
          ...stamped(playlistItems, now),
        })
        .where(eq(playlistItems.id, itemId))
        .run();
    }
    for (let i = 0; i < drops.length; i += LINK_CHUNK) {
      tx.update(playlistItems)
        .set({ deleted: true, ...stamped(playlistItems, now) })
        .where(inArray(playlistItems.id, drops.slice(i, i + LINK_CHUNK)))
        .run();
    }
    tx.update(playlists).set({ updatedAt: now }).where(inArray(playlists.id, playlistIds)).run();
    return { rewritten: rewrites.length, removed: drops.length, playlistIds };
  });

/** What settling an unsearched song changed (`settleUnsearchedEntries`). */
export interface UnsearchedEntriesSettled {
  readonly rewritten: number;
  readonly removed: number;
  /** The playlists that held it. */
  readonly playlistIds: readonly number[];
}

/** A playlist's unsearched songs, top to bottom (`selectUnsearchedEntries`). */
export interface PlaylistUnsearched {
  readonly playlistId: number;
  readonly songs: readonly UnsearchedSong[];
}

/**
 * The stored songs [which] picks among the entries playlists hold (not
 * removed, in a playlist not deleted), each with its playlist.
 */
const liveStoredSongs = (db: LibraryDatabase, which: SQL | undefined) => {
  const { playlists, playlistItems } = schema;
  return db
    .select({ playlistId: playlistItems.playlistId, ytSong: sql<string>`${playlistItems.ytSong}` })
    .from(playlistItems)
    .innerJoin(playlists, eq(playlists.id, playlistItems.playlistId))
    .where(and(live, livePlaylist, which));
};

/**
 * Every playlist holding unsearched entries, with them top to bottom, for
 * the background fill (Core's `nextFillStep`). Only those entries are
 * decoded; a deleted playlist's aren't read.
 */
export const selectUnsearchedEntries = (db: LibraryDatabase): PlaylistUnsearched[] => {
  const rows = liveStoredSongs(db, storedUnsearched)
    .orderBy(asc(schema.playlistItems.playlistId), ...IN_ORDER)
    .all();
  const byPlaylist = new Map<number, UnsearchedSong[]>();
  for (const { playlistId, ytSong } of rows) {
    const stored = decode(playlistId, ytSong);
    if (stored?.source !== "unsearched") continue;
    const songs = byPlaylist.get(playlistId) ?? [];
    songs.push(stored.song);
    byPlaylist.set(playlistId, songs);
  }
  return [...byPlaylist].map(([playlistId, songs]) => ({ playlistId, songs }));
};

/**
 * The video ids of the YT Music entries in the owner's playlists, each once,
 * for Discover's Magic Queue row (Core's `MagicQueuePool`): ids only, no song
 * decoded. A video the Library has as a file is left out (it's in the pool as
 * the Library's song); unsearched and unavailable entries have no video id.
 */
export const selectPlaylistEntryVideoIds = (db: LibraryDatabase): string[] => {
  const { playlists, playlistItems, tracks } = schema;
  const videoId = sql<string>`${storedVideoId}`;
  return db
    .selectDistinct({ videoId })
    .from(playlistItems)
    .innerJoin(playlists, eq(playlists.id, playlistItems.playlistId))
    .where(
      and(
        isNotNull(playlistItems.ytSong),
        live,
        livePlaylist,
        sql`typeof(${videoId}) = 'text' AND ${videoId} <> ''`,
        sql`${videoId} NOT IN (SELECT ${tracks.videoId} FROM ${tracks}
          WHERE ${tracks.videoId} IS NOT NULL AND ${hasFile})`,
      ),
    )
    .orderBy(videoId)
    .all()
    .map((row) => row.videoId);
};

/**
 * The YT Music songs the owner's playlists hold as [videoIds], one per video
 * (`selectPlaylistEntryVideoIds`), in no particular order; a video no
 * playlist holds any more is left out. Only those entries are decoded.
 */
export const selectPlaylistEntrySongs = (
  db: LibraryDatabase,
  videoIds: readonly string[],
): YtAlbumSong[] => {
  if (videoIds.length === 0) return [];
  const rows = liveStoredSongs(
    db,
    and(isNotNull(schema.playlistItems.ytSong), sql`${storedVideoId} IN ${jsonList(videoIds)}`),
  ).all();
  const songs = new Map<string, YtAlbumSong>();
  for (const { playlistId, ytSong } of rows) {
    const stored = decode(playlistId, ytSong);
    if (stored?.source === "stream" && !songs.has(stored.song.videoId))
      songs.set(stored.song.videoId, stored.song);
  }
  return [...songs.values()];
};

/** A playlist's mosaic: thumbnails for lists and menus, full-size covers for its screen's header. */
export interface PlaylistCovers {
  readonly thumbPaths: readonly string[];
  readonly artworkPaths: readonly string[];
}

/** The most tiles a mosaic has (Core's `playlistMosaic`). */
const MOSAIC_TILES = 4;

/** Playlist entries `pi` of [playlists] (one id or several), or of every playlist when not given. */
const entriesOf = (playlists: number | readonly number[] | undefined) =>
  playlists === undefined
    ? sql`1`
    : typeof playlists === "number"
      ? sql`pi.playlist_id = ${playlists}`
      : sql`pi.playlist_id IN ${jsonList(playlists)}`;

/** Up to this many playlists' mosaics are found by walking each from its top (`walkCovers`). */
const WALKED_MOSAICS = 4;

/** Entries `walkCovers` reads first; each further read takes four times as many. */
const FIRST_WALK = 16;

/**
 * [playlistId]'s mosaic, found by reading its entries from the top, a few at
 * a time, until four different covers turned up (or it ends): what
 * `selectPlaylistCovers` picks for every playlist at once, without reading a
 * long playlist whole. Null when it has no cover.
 */
const walkCovers = (db: LibraryDatabase, playlistId: number): PlaylistCovers | null => {
  const thumbs: string[] = [];
  const paths: string[] = [];
  const seen = new Set<string>();
  for (let offset = 0, limit = FIRST_WALK; thumbs.length < MOSAIC_TILES;) {
    const rows = db.all<{ cover: string | null; thumbPath: string; path: string }>(sql`
      SELECT coalesce(aw.hash, items.url) AS cover,
        coalesce(aw.thumb_path, items.url) AS thumbPath,
        coalesce(aw.path, items.url) AS path
      FROM (
        SELECT pi.order_key, pi.sync_id, al.artwork_hash,
          CASE WHEN json_valid(pi.yt_song) THEN
            CASE json_type(pi.yt_song, '$.artworkUrl')
              WHEN 'text' THEN json_extract(pi.yt_song, '$.artworkUrl')
            END
          END AS url
        FROM playlist_items pi
        LEFT JOIN tracks t ON t.id = pi.track_id
        LEFT JOIN albums al ON al.id = t.album_id
        WHERE pi.playlist_id = ${playlistId} AND NOT pi.deleted
        ORDER BY pi.order_key, pi.sync_id
        LIMIT ${limit} OFFSET ${offset}
      ) AS items
      LEFT JOIN artwork aw ON aw.hash = items.artwork_hash
      ORDER BY items.order_key, items.sync_id`);
    for (const row of rows) {
      if (row.cover === null || seen.has(row.cover)) continue;
      seen.add(row.cover);
      thumbs.push(row.thumbPath);
      paths.push(row.path);
      if (thumbs.length === MOSAIC_TILES) break;
    }
    if (rows.length < limit) break;
    offset += limit;
    limit *= 4;
  }
  if (thumbs.length === 0) return null;
  return { thumbPaths: playlistMosaic(thumbs), artworkPaths: playlistMosaic(paths) };
};

/**
 * Each playlist's mosaic (Core's `playlistMosaic`), from what it holds in
 * playlist order: a Library track's album cover (a file), a YT Music entry's
 * cover (YouTube's address). Only [playlists]' when given (one id or several).
 * SQLite picks each playlist's first four different covers, so only those are read.
 */
export const selectPlaylistCovers = (
  db: LibraryDatabase,
  playlists?: number | readonly number[],
): Map<number, PlaylistCovers> => {
  if (typeof playlists === "number") playlists = [playlists];
  if (playlists !== undefined && playlists.length <= WALKED_MOSAICS) {
    const mosaics = new Map<number, PlaylistCovers>();
    for (const id of playlists) {
      const covers = walkCovers(db, id);
      if (covers !== null) mosaics.set(id, covers);
    }
    return mosaics;
  }
  const inPlaylist = entriesOf(playlists);
  // A cover is an artwork row (its file and thumbnail) or an entry's address
  // (both at once); unreadable stored songs give none.
  const rows = db.all<{ playlistId: number; thumbPath: string; path: string }>(sql`
    WITH items AS (
      SELECT pi.playlist_id, pi.order_key, pi.sync_id, al.artwork_hash,
        CASE WHEN json_valid(pi.yt_song) THEN
          CASE json_type(pi.yt_song, '$.artworkUrl')
            WHEN 'text' THEN json_extract(pi.yt_song, '$.artworkUrl')
          END
        END AS url
      FROM playlist_items pi
      LEFT JOIN tracks t ON t.id = pi.track_id
      LEFT JOIN albums al ON al.id = t.album_id
      WHERE NOT pi.deleted AND ${inPlaylist}
    ),
    covers AS (
      SELECT items.playlist_id, items.order_key, items.sync_id,
        coalesce(aw.hash, items.url) AS cover,
        coalesce(aw.thumb_path, items.url) AS thumb_path,
        coalesce(aw.path, items.url) AS path
      FROM items
      LEFT JOIN artwork aw ON aw.hash = items.artwork_hash
    ),
    firsts AS (
      SELECT *, row_number() OVER (
        PARTITION BY playlist_id, cover ORDER BY order_key, sync_id
      ) AS seen
      FROM covers
      WHERE cover IS NOT NULL
    ),
    tiles AS (
      SELECT *, row_number() OVER (
        PARTITION BY playlist_id ORDER BY order_key, sync_id
      ) AS tile
      FROM firsts
      WHERE seen = 1
    )
    SELECT playlist_id AS playlistId, thumb_path AS thumbPath, path
    FROM tiles
    WHERE tile <= ${MOSAIC_TILES}
    ORDER BY playlist_id, tile`);
  const grouped = new Map<number, { thumbs: string[]; paths: string[] }>();
  for (const row of rows) {
    let group = grouped.get(row.playlistId);
    if (group === undefined) {
      group = { thumbs: [], paths: [] };
      grouped.set(row.playlistId, group);
    }
    group.thumbs.push(row.thumbPath);
    group.paths.push(row.path);
  }
  return new Map(
    [...grouped].map(([id, group]) => [
      id,
      { thumbPaths: playlistMosaic(group.thumbs), artworkPaths: playlistMosaic(group.paths) },
    ]),
  );
};

/** How many songs a playlist holds, how long they play, and how many of them are unavailable. */
export interface PlaylistTotals {
  readonly trackCount: number;
  readonly durationMs: number;
  /** Its unavailable entries, counted in [trackCount] too. */
  readonly unavailableCount: number;
}

/**
 * Whether the stored YT Music song `pi.yt_song` is one Core's
 * `readPlaylistYtSong` reads: an object with a video id, a title, artists
 * (names), an album and a cover (each a text or null) and a length (a number
 * or null). SQLite checks it without handing the song to JavaScript.
 */
const READABLE_YT_SONG = sql`CASE
  WHEN NOT json_valid(pi.yt_song) THEN 0
  WHEN json_type(pi.yt_song) <> 'object' THEN 0
  ELSE coalesce(
    json_type(pi.yt_song, '$.videoId') = 'text'
      AND json_extract(pi.yt_song, '$.videoId') <> ''
      AND json_type(pi.yt_song, '$.title') = 'text'
      AND json_type(pi.yt_song, '$.artists') = 'array'
      AND NOT EXISTS (
        SELECT 1 FROM json_each(pi.yt_song, '$.artists') WHERE json_each.type <> 'text')
      AND json_type(pi.yt_song, '$.album') IN ('null', 'text')
      AND json_type(pi.yt_song, '$.artworkUrl') IN ('null', 'text')
      AND json_type(pi.yt_song, '$.durationMs') IN ('null', 'integer', 'real'),
    0)
END`;

/**
 * Whether the stored song `pi.yt_song` is an unavailable song Core's
 * `readPlaylistEntrySong` reads (and not a YT Music song): marked by why it's
 * unavailable, with a title, artists (names), an album and a cover (each a
 * text or null) and a length (a number or null).
 */
const READABLE_UNAVAILABLE_SONG = sql`CASE
  WHEN NOT json_valid(pi.yt_song) THEN 0
  WHEN json_type(pi.yt_song) <> 'object' THEN 0
  WHEN ${READABLE_YT_SONG} THEN 0
  ELSE coalesce(
    json_extract(pi.yt_song, '$.unavailable') IN ('notFound', 'localFile')
      AND json_type(pi.yt_song, '$.unavailable') = 'text'
      AND json_type(pi.yt_song, '$.title') = 'text'
      AND json_type(pi.yt_song, '$.artists') = 'array'
      AND NOT EXISTS (
        SELECT 1 FROM json_each(pi.yt_song, '$.artists') WHERE json_each.type <> 'text')
      AND json_type(pi.yt_song, '$.album') IN ('null', 'text')
      AND json_type(pi.yt_song, '$.artworkUrl') IN ('null', 'text')
      AND json_type(pi.yt_song, '$.durationMs') IN ('null', 'integer', 'real'),
    0)
END`;

/**
 * Whether the stored song `pi.yt_song` is an unsearched song Core's
 * `readPlaylistEntrySong` reads (and not a YT Music song): marked
 * unsearched, with a title, artists (names), an album and a cover (each a
 * text or null) and a length (a number or null).
 */
const READABLE_UNSEARCHED_SONG = sql`CASE
  WHEN NOT json_valid(pi.yt_song) THEN 0
  WHEN json_type(pi.yt_song) <> 'object' THEN 0
  WHEN ${READABLE_YT_SONG} THEN 0
  ELSE coalesce(
    json_type(pi.yt_song, '$.unsearched') = 'true'
      AND json_type(pi.yt_song, '$.title') = 'text'
      AND json_type(pi.yt_song, '$.artists') = 'array'
      AND NOT EXISTS (
        SELECT 1 FROM json_each(pi.yt_song, '$.artists') WHERE json_each.type <> 'text')
      AND json_type(pi.yt_song, '$.album') IN ('null', 'text')
      AND json_type(pi.yt_song, '$.artworkUrl') IN ('null', 'text')
      AND json_type(pi.yt_song, '$.durationMs') IN ('null', 'integer', 'real'),
    0)
END`;

/**
 * Each playlist's song count and length (only [playlists]' when given: one id
 * or several), YT Music, unsearched and unavailable entries included (one of
 * unknown length adds nothing to it), and how many are unavailable (an
 * unsearched one isn't). An entry whose stored song can't be read is left
 * out, as the playlist's list leaves it out (`selectPlaylistEntries`, with
 * Core's `readPlaylistEntrySong`; SQLite makes the same checks here,
 * `READABLE_YT_SONG`, `READABLE_UNSEARCHED_SONG`, `READABLE_UNAVAILABLE_SONG`).
 * Playlists holding nothing are left out.
 */
export const selectPlaylistTotals = (
  db: LibraryDatabase,
  playlists?: number | readonly number[],
): Map<number, PlaylistTotals> => {
  const rows = db.all<PlaylistTotals & { playlistId: number }>(sql`
    SELECT pi.playlist_id AS playlistId, count(*) AS trackCount,
      coalesce(sum(CASE
        WHEN pi.track_id IS NOT NULL THEN t.duration_ms
        WHEN json_valid(pi.yt_song) THEN json_extract(pi.yt_song, '$.durationMs')
      END), 0) AS durationMs,
      coalesce(sum(CASE WHEN pi.track_id IS NULL THEN ${READABLE_UNAVAILABLE_SONG} ELSE 0 END), 0)
        AS unavailableCount
    FROM playlist_items pi
    LEFT JOIN tracks t ON t.id = pi.track_id
    WHERE NOT pi.deleted AND ${entriesOf(playlists)}
      -- A Library entry whose track is gone is on its way out (the cascade), never counted.
      AND CASE WHEN pi.track_id IS NOT NULL THEN t.id IS NOT NULL
        ELSE ${READABLE_YT_SONG} OR ${READABLE_UNSEARCHED_SONG} OR ${READABLE_UNAVAILABLE_SONG} END
    GROUP BY pi.playlist_id`);
  return new Map(rows.map(({ playlistId, ...total }) => [playlistId, total]));
};

const NO_COVERS = { thumbPaths: [], artworkPaths: [] } as const;
const NO_SONGS = { trackCount: 0, durationMs: 0, unavailableCount: 0 } as const;

/** A playlist's mosaic and totals, as Library › Playlists and its page show them. */
interface PlaylistSummary {
  readonly covers: PlaylistCovers;
  readonly totals: PlaylistTotals;
}

/**
 * Per database, each playlist's summary as last worked out, with the
 * revisions it was worked out at (`playlistRevisions`: the playlist's, then
 * the Library's). Holds one per live playlist at most: Library › Playlists
 * drops deleted ones.
 */
const summaryCache = new WeakMap<
  LibraryDatabase,
  Map<number, { readonly at: string; readonly summary: PlaylistSummary }>
>();

/** The Library's row in `playlist_revisions` (no playlist has id 0). */
const LIBRARY_REVISION = 0;

/**
 * [playlistIds]' mosaics and totals. Those whose entries (or the Library's
 * tracks, albums and covers) changed since they were last worked out are
 * worked out again, together; the others are taken as they were. SQLite's
 * triggers keep the revisions (migration 0022), so every write counts: this
 * phone's edits, pulled ones, links to downloads, songs leaving the Library.
 * Not for use inside a write transaction that may roll back.
 */
const playlistSummaries = (
  db: LibraryDatabase,
  playlistIds: readonly number[],
  /** Totals the caller just counted (a page from the entries it read): not counted again. */
  counted?: ReadonlyMap<number, PlaylistTotals>,
): Map<number, PlaylistSummary> => {
  let cache = summaryCache.get(db);
  if (cache === undefined) {
    cache = new Map();
    summaryCache.set(db, cache);
  }
  const revisions = new Map(
    db
      .select()
      .from(schema.playlistRevisions)
      .all()
      .map((row) => [row.playlistId, row.revision]),
  );
  const library = revisions.get(LIBRARY_REVISION) ?? 0;
  const at = (id: number): string => `${revisions.get(id) ?? 0}:${library}`;
  const stale = playlistIds.filter((id) => cache.get(id)?.at !== at(id));
  if (stale.length > 0) {
    const covers = selectPlaylistCovers(db, stale);
    const uncounted = stale.filter((id) => counted?.get(id) === undefined);
    const totals = uncounted.length === 0 ? new Map() : selectPlaylistTotals(db, uncounted);
    for (const id of stale) {
      countSummarized(id);
      cache.set(id, {
        at: at(id),
        summary: {
          covers: covers.get(id) ?? NO_COVERS,
          totals: counted?.get(id) ?? totals.get(id) ?? NO_SONGS,
        },
      });
    }
  }
  const summaries = new Map<number, PlaylistSummary>();
  for (const id of playlistIds) {
    const known = cache.get(id);
    if (known !== undefined) summaries.set(id, known.summary);
  }
  return summaries;
};

/** Forgets the summaries of playlists not in [kept] (deleted ones). */
const keepSummaries = (db: LibraryDatabase, kept: ReadonlySet<number>): void => {
  const cache = summaryCache.get(db);
  if (cache === undefined) return;
  for (const id of cache.keys()) if (!kept.has(id)) cache.delete(id);
};

/** A playlist's own image, when the owner gave it one (`db/playlistImages.ts`). */
const imageColumns = {
  imagePath: schema.playlists.imagePath,
  imageThumbPath: schema.playlists.imageThumbPath,
};

/**
 * What a playlist's artwork shows (Core's `playlistArtwork`): its own image,
 * else its mosaic of [covers].
 */
const playlistArt = (
  image: { readonly imagePath: string | null; readonly imageThumbPath: string | null },
  covers: PlaylistCovers,
): PlaylistCovers & { readonly hasImage: boolean } => {
  // Both files are set together; a row with one alone shows its mosaic.
  const own = image.imagePath !== null && image.imageThumbPath !== null;
  return {
    thumbPaths: playlistArtwork(own ? image.imageThumbPath : null, covers.thumbPaths),
    artworkPaths: playlistArtwork(own ? image.imagePath : null, covers.artworkPaths),
    hasImage: own,
  };
};

/**
 * How many songs [entries] are, how long they play (one of unknown length
 * adds nothing) and how many are unavailable.
 */
const entriesTotals = (entries: readonly PlaylistEntry[]): PlaylistTotals => {
  let durationMs = 0;
  let unavailableCount = 0;
  for (const entry of entries) {
    durationMs +=
      entry.source === "library" ? entry.track.durationMs : (entry.song.durationMs ?? 0);
    if (entry.source === "unavailable") unavailableCount += 1;
  }
  return { trackCount: entries.length, durationMs, unavailableCount };
};

/** Playlists the owner has: not deleted (tombstones). */
const livePlaylist = eq(schema.playlists.deleted, false);

/**
 * When a song last started playing from each playlist (a play whose context
 * is the playlist, streamed songs' included), by playlist id, for sorting the Playlists list by Recently
 * Played (Core's `sortPlaylists`). Playlists never played from aren't in it.
 */
export const selectPlaylistsLastPlayed = (db: LibraryDatabase): Map<number, number> => {
  const { playEvents } = schema;
  const rows = db
    .select({ id: playEvents.contextId, at: sql<number>`max(${playEvents.startedAt})` })
    .from(playEvents)
    .where(and(eq(playEvents.contextType, "playlist"), isNotNull(playEvents.contextId)))
    .groupBy(playEvents.contextId)
    .all();
  const lastPlayed = new Map<number, number>();
  for (const { id, at } of rows) {
    const playlistId = Number(id);
    if (Number.isSafeInteger(playlistId)) lastPlayed.set(playlistId, at);
  }
  return lastPlayed;
};

/**
 * Every playlist by name, with its artwork (its own image or its mosaic) and
 * totals; deleted ones (tombstones) aren't listed. Only the playlists that
 * changed since the last read have their mosaic and totals worked out again
 * (`playlistSummaries`).
 */
export const selectPlaylists = (db: LibraryDatabase): PlaylistRow[] => {
  const { playlists } = schema;
  countListRead();
  const rows = db
    .select({
      id: playlists.id,
      name: playlists.name,
      createdAt: playlists.createdAt,
      ...imageColumns,
    })
    .from(playlists)
    .where(livePlaylist)
    .all();
  const ids = rows.map((row) => row.id);
  keepSummaries(db, new Set(ids));
  // Library tracks and YT Music entries alike.
  const summaries = playlistSummaries(db, ids);
  return (
    rows
      .map(({ imagePath, imageThumbPath, ...row }) => ({
        ...row,
        sort: sortKey(row.name),
        ...(summaries.get(row.id)?.totals ?? NO_SONGS),
        ...playlistArt({ imagePath, imageThumbPath }, summaries.get(row.id)?.covers ?? NO_COVERS),
      }))
      // oxlint-disable-next-line unicorn/no-array-sort -- sorts a fresh array; Hermes lacks toSorted
      .sort((a, b) => compareStrings(a.sort, b.sort) || a.id - b.id)
  );
};

/** A playlist with its entries in playlist order; null when it's gone (or deleted). */
export const selectPlaylist = (
  db: LibraryDatabase,
  id: number,
  scope: TrackScope = "library",
): PlaylistDetail | null => {
  const { playlists } = schema;
  countPageRead(id);
  const row = db
    .select({
      id: playlists.id,
      name: playlists.name,
      createdAt: playlists.createdAt,
      ...imageColumns,
    })
    .from(playlists)
    .where(and(eq(playlists.id, id), livePlaylist))
    .get();
  if (row === undefined) return null;
  const { imagePath, imageThumbPath, ...playlist } = row;
  const items = selectPlaylistEntries(db, id, undefined, scope);
  // As Library › Playlists counts it, and shared with it. Every Library song
  // is among the entries, as is every readable YT Music song: counted from them.
  const counted = scope === "library" ? new Map([[id, entriesTotals(items)]]) : undefined;
  const summary = playlistSummaries(db, [id], counted).get(id);
  const covers = summary?.covers ?? NO_COVERS;
  const { trackCount, durationMs, unavailableCount } = summary?.totals ?? NO_SONGS;
  return {
    playlist: {
      ...playlist,
      sort: sortKey(playlist.name),
      trackCount,
      durationMs,
      unavailableCount,
      ...playlistArt({ imagePath, imageThumbPath }, covers),
    },
    items,
  };
};

/** The names of the playlists the owner has, but [except]'s. */
const otherNames = (db: LibraryDatabase, except?: number): string[] => {
  const { playlists } = schema;
  return db
    .select({ name: playlists.name })
    .from(playlists)
    .where(and(livePlaylist, except === undefined ? undefined : ne(playlists.id, except)))
    .all()
    .map((row) => row.name);
};

/** Fails with the reason when Core rejects the name. */
const requireName = (name: string, others: readonly string[]): string => {
  const check = checkPlaylistName(name, others);
  if (!check.ok) throw new Error(`Playlist name rejected (${check.problem})`);
  return check.name;
};

/**
 * Creates a playlist holding [songs], Library tracks and YT Music songs in
 * the order given (Core's `checkPlaylistName` must accept the name, or it
 * fails), with an id of its own for every phone.
 */
export const createPlaylist = (
  db: LibraryDatabase,
  name: string,
  songs: readonly PlaylistSong[],
  now: number,
): PlaylistAddResult =>
  db.transaction((tx) => {
    const { playlists } = schema;
    const stored = requireName(name, otherNames(tx));
    const created = tx
      .insert(playlists)
      .values({ name: stored, createdAt: now, updatedAt: now, changedAt: now })
      .returning({ id: playlists.id })
      .get();
    return {
      playlistId: created.id,
      name: stored,
      ...appendPlaylistSongs(tx, created.id, songs, now),
    };
  });

/** Renames a playlist (Core's `checkPlaylistName` must accept the name, or it fails). */
export const renamePlaylist = (db: LibraryDatabase, id: number, name: string, now: number): void =>
  db.transaction((tx) => {
    const { playlists } = schema;
    tx.update(playlists)
      .set({
        name: requireName(name, otherNames(tx, id)),
        updatedAt: now,
        ...stamped(playlists, now),
      })
      .where(and(eq(playlists.id, id), livePlaylist))
      .run();
  });

/** Deletes a playlist: it and its entries stay as tombstones, which nothing lists. */
export const deletePlaylist = (db: LibraryDatabase, id: number, now: number): void =>
  db.transaction((tx) => {
    const { playlists } = schema;
    tombstoneEntries(tx, id, undefined, now);
    tx.update(playlists)
      .set({ deleted: true, updatedAt: now, ...stamped(playlists, now) })
      .where(and(eq(playlists.id, id), livePlaylist))
      .run();
  });

/** Appends the songs a playlist doesn't hold yet (Core's `planPlaylistSongs`); fails when it's gone. */
export const addToPlaylist = (
  db: LibraryDatabase,
  id: number,
  songs: readonly PlaylistSong[],
  now: number,
): PlaylistAddResult =>
  db.transaction((tx) => {
    const { playlists } = schema;
    const playlist = tx
      .select({ name: playlists.name })
      .from(playlists)
      .where(and(eq(playlists.id, id), livePlaylist))
      .get();
    if (playlist === undefined) throw new Error("The playlist no longer exists");
    const result = appendPlaylistSongs(tx, id, songs, now);
    if (result.added > 0)
      tx.update(playlists).set({ updatedAt: now }).where(eq(playlists.id, id)).run();
    return { playlistId: id, name: playlist.name, ...result };
  });

/** One explicit Recognize save, using the playlist's shared id rather than its name. */
export const addToShazam = (
  db: LibraryDatabase,
  rememberedId: string | null,
  song: PlaylistSong,
  now: number,
  language: AppLanguage = "en",
): { readonly playlistId: number; readonly syncId: string; readonly toast: string } =>
  db.transaction((tx) => {
    const { playlists, playlistItems } = schema;
    const available = tx
      .select({ localId: playlists.id, id: playlists.syncId, name: playlists.name })
      .from(playlists)
      .where(livePlaylist)
      .all();
    const remembered = available.find((playlist) => playlist.id === rememberedId);
    const existing: PlaylistSong[] =
      remembered === undefined
        ? []
        : tx
            .select({ trackId: playlistItems.trackId, ytSong: playlistItems.ytSong })
            .from(playlistItems)
            .where(and(eq(playlistItems.playlistId, remembered.localId), live))
            .all()
            .flatMap((entry): PlaylistSong[] => {
              if (entry.ytSong !== null) {
                const stored = decode(remembered.localId, entry.ytSong);
                return stored === null ? [] : [stored];
              }
              return entry.trackId === null ? [] : [{ source: "library", trackId: entry.trackId }];
            });
    const plan = planShazamAdd(rememberedId, available, existing, song, language);
    if (plan.kind === "create") {
      const created = tx
        .insert(playlists)
        .values({ name: plan.name, createdAt: now, updatedAt: now, changedAt: now })
        .returning({ playlistId: playlists.id, syncId: playlists.syncId })
        .get();
      placeSongs(tx, created.playlistId, [], plan.index, [plan.song], now);
      return { ...created, toast: plan.toast };
    }
    // The plan can target only the live playlist read in this transaction.
    if (remembered === undefined) throw new Error("The playlist no longer exists");
    if (plan.kind === "add") {
      placeSongs(
        tx,
        remembered.localId,
        orderedEntries(tx, remembered.localId),
        plan.index,
        [plan.song],
        now,
      );
      tx.update(playlists)
        .set({ updatedAt: now })
        .where(eq(playlists.id, remembered.localId))
        .run();
    }
    return { playlistId: remembered.localId, syncId: remembered.id, toast: plan.toast };
  });
