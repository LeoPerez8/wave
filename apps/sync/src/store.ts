/**
 * Reading and writing an account's synced rows. A push merges by Core's
 * rules (`mergeTableRows`, `mergePlays`), so the service and the app can't
 * disagree, and numbers each accepted change in the same transaction that
 * writes it: a pull reads in one snapshot and pages by those numbers, so it
 * never misses a change pushed while it runs.
 */

import type { Client, InStatement, InValue, Transaction } from "@libsql/client";
import {
  collaborativeRow,
  memberPlaylistFields,
  mergePlays,
  mergeTableRows,
  withinServiceClock,
} from "@wave/core";
import {
  type Membership,
  endOwnedCollaboration,
  forgetAccountStatements,
  membershipStatements,
  ownedCollaborations,
  passCollaboration,
  readMembership,
} from "./collaborations.ts";
import type { SyncLimitName, SyncLimits } from "./limits.ts";
import {
  type IncomingRow,
  type SyncTable,
  SYNC_TABLES,
  column,
  rowFields,
  withFields,
  wireRow,
} from "./tables.ts";

/** A checked push: the rows for each table it names. */
export type PushBatch = ReadonlyMap<SyncTable, readonly IncomingRow[]>;

/** A row stored with the service's time, and that time. */
export interface CorrectedRow {
  readonly id: string;
  readonly changedAt: number;
}

export type PushResult =
  | {
      readonly accepted: Readonly<Record<string, number>>;
      /** By table name, the rows stored with another change time than the one pushed. */
      readonly corrected: Readonly<Record<string, readonly CorrectedRow[]>>;
    }
  | { readonly overLimit: SyncLimitName };

/** How many ids go in one `IN (…)`. */
const IDS_PER_QUERY = 200;

const chunks = <T>(items: readonly T[], size: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
};

/** The merge fields of [table]'s rows held for [ids]. */
const heldRows = async (
  tx: Transaction,
  table: SyncTable,
  accountId: string,
  ids: readonly string[],
): Promise<IncomingRow[]> => {
  const held: IncomingRow[] = [];
  const restores = table.name === "playlistEntries";
  const merged =
    table.kind === "rows"
      ? `id, changed_at, phone_id, deleted${restores ? ", restored_at" : ""}`
      : "id";
  for (const chunk of chunks(ids, IDS_PER_QUERY)) {
    const result = await tx.execute({
      sql: `SELECT ${merged} FROM ${table.sqlName}
            WHERE account_id = ? AND id IN (${chunk.map(() => "?").join(", ")})`,
      args: [accountId, ...chunk],
    });
    for (const row of result.rows) {
      held.push({
        id: String(row.id),
        changedAt: Number(row.changed_at ?? 0),
        phoneId: String(row.phone_id ?? ""),
        deleted: Number(row.deleted ?? 0) === 1,
        ...(restores && row.restored_at !== null && row.restored_at !== undefined
          ? { restoredAt: Number(row.restored_at) }
          : {}),
        values: null,
      });
    }
  }
  return held;
};

/**
 * [incoming] as the merge reads it: a live entry from a Wave that sends no restore time
 * carries the one [held] for it, which is also what stays stored (`keptWhenOmitted`).
 */
const withKeptRestores = (
  held: readonly IncomingRow[],
  incoming: readonly IncomingRow[],
): readonly IncomingRow[] => {
  const restored = new Map(
    held.flatMap((row) =>
      row.deleted || row.restoredAt === undefined ? [] : [[row.id, row.restoredAt] as const],
    ),
  );
  if (restored.size === 0) return incoming;
  return incoming.map((row) => {
    const kept = restored.get(row.id);
    return kept !== undefined && !row.deleted && row.omitted?.includes("restoredAt") === true
      ? { ...row, restoredAt: kept }
      : row;
  });
};

/** The statement that stores accepted [row] of [table] as change number [changeNo]. */
const upsert = (
  table: SyncTable,
  accountId: string,
  row: IncomingRow,
  changeNo: number,
  writerId: string,
): InStatement => {
  const fields = Object.keys(table.fields).map(column);
  const columns = ["account_id", "id", "change_no"];
  const args: InValue[] = [accountId, row.id, changeNo];
  if (table.kind === "rows") {
    columns.push("changed_at", "phone_id", "deleted");
    args.push(row.changedAt, row.phoneId, row.deleted ? 1 : 0);
  }
  columns.push(...fields);
  args.push(...(row.values ?? fields.map(() => null)));
  // A field a Wave from before it left out keeps what's stored (`keptWhenOmitted`).
  const kept = new Set((row.omitted ?? []).map(column));
  // The account that first stored the row: the writer's for a new one, kept for a stored one.
  if (table.writtenBy !== undefined) {
    const writer = column(table.writtenBy);
    args[columns.indexOf(writer)] = writerId;
    kept.add(writer);
  }
  const updates = columns
    .filter((name) => name !== "account_id" && name !== "id")
    .map((name) =>
      kept.has(name) ? `${name} = ${table.sqlName}.${name}` : `${name} = excluded.${name}`,
    );
  return {
    sql: `INSERT INTO ${table.sqlName} (${columns.join(", ")})
          VALUES (${columns.map(() => "?").join(", ")})
          ON CONFLICT (account_id, id) DO UPDATE SET ${updates.join(", ")}`,
    args,
  };
};

/** How many of [accountId]'s rows [table] retains, deletion records included. */
const retainedRowCount = async (tx: Transaction, table: SyncTable, accountId: string) => {
  const result = await tx.execute({
    sql: `SELECT count(*) AS n FROM ${table.sqlName} WHERE account_id = ?`,
    args: [accountId],
  });
  return Number(result.rows[0]?.n ?? 0);
};

/** Whether [error] is SQLite saying another writer holds the database. */
const isBusy = (error: unknown): boolean =>
  error instanceof Error &&
  /SQLITE_BUSY|database is locked/i.test(
    `${error.message} ${String((error as { code?: unknown }).code)}`,
  );

/** Runs [work] in a write transaction, again when another writer held the database. */
const inWriteTransaction = async <T>(
  db: Client,
  work: (tx: Transaction) => Promise<T>,
): Promise<T> => {
  for (let attempt = 1; ; attempt++) {
    let tx: Transaction;
    try {
      tx = await db.transaction("write");
    } catch (error) {
      if (attempt < 8 && isBusy(error)) {
        await new Promise((resolve) => setTimeout(resolve, 10 * attempt));
        continue;
      }
      throw error;
    }
    try {
      const result = await work(tx);
      if (!tx.closed) await tx.commit();
      return result;
    } finally {
      tx.close();
    }
  }
};

/** A Library song's own fields that an entry of a collaborative playlist carries. */
const SONG_FIELDS: readonly string[] = ["title", "credit", "album", "durationMs", "videoId"];

const tableNamed = (name: string): SyncTable => {
  const table = SYNC_TABLES.find((candidate) => candidate.name === name);
  if (table === undefined) throw new Error(`no table ${name}`);
  return table;
};

const PLAYLISTS = tableNamed("playlists");
const ENTRIES = tableNamed("playlistEntries");

/** The ids of the collaborative playlists [accountId] owns. */
const ownedCollaborative = async (tx: Transaction, accountId: string): Promise<Set<string>> => {
  const result = await tx.execute({
    sql: "SELECT playlist_id FROM collaborations WHERE owner_id = ?",
    args: [accountId],
  });
  return new Set(result.rows.map((row) => String(row.playlist_id)));
};

/** Those of [ids] that [accountId] holds as a deleted playlist. */
const deletedPlaylists = async (
  tx: Transaction,
  accountId: string,
  ids: readonly string[],
): Promise<Set<string>> => {
  const deleted = new Set<string>();
  for (const chunk of chunks(ids, IDS_PER_QUERY)) {
    const result = await tx.execute({
      sql: `SELECT id FROM playlists WHERE account_id = ? AND deleted = 1
              AND id IN (${chunk.map(() => "?").join(", ")})`,
      args: [accountId, ...chunk],
    });
    for (const row of result.rows) deleted.add(String(row.id));
  }
  return deleted;
};

/** The playlist a pushed entry names, when it carries its fields. */
const entryPlaylist = (row: IncomingRow): string | null => {
  const playlistId = row.values === null ? null : rowFields(ENTRIES, row).playlistId;
  return typeof playlistId === "string" ? playlistId : null;
};

/**
 * [rows] of [table] with those of [collaborative] playlists as such a playlist
 * keeps them (Core's `collaborativeRow`); and, when [fill], each Library entry
 * that arrives with its recording key alone, as a Wave from before the song's
 * fields sends it, filled from [accountId]'s song.
 */
const asCollaborative = async (
  tx: Transaction,
  accountId: string,
  table: SyncTable,
  rows: readonly IncomingRow[],
  collaborative: ReadonlySet<string>,
  fill: boolean,
): Promise<readonly IncomingRow[]> => {
  if (collaborative.size === 0 || rows.length === 0) return rows;
  if (table === PLAYLISTS) {
    return rows.map((row) =>
      row.values !== null && collaborative.has(row.id)
        ? withFields(table, row, collaborativeRow("playlists", rowFields(table, row)))
        : row,
    );
  }
  if (table !== ENTRIES) return rows;
  const inPlaylist = (row: IncomingRow): boolean => {
    const playlistId = entryPlaylist(row);
    return playlistId !== null && collaborative.has(playlistId);
  };
  /** The recording key of an entry to fill, which came with no song field. */
  const bare = (row: IncomingRow): string | null => {
    const songId = row.values === null ? null : rowFields(table, row).songId;
    return fill &&
      typeof songId === "string" &&
      SONG_FIELDS.every((name) => row.omitted?.includes(name) === true)
      ? songId
      : null;
  };
  const songIds = [...new Set(rows.filter(inPlaylist).flatMap((row) => bare(row) ?? []))];
  const songs = new Map<string, Readonly<Record<string, unknown>>>();
  for (const chunk of chunks(songIds, IDS_PER_QUERY)) {
    const result = await tx.execute({
      sql: `SELECT id, title, credit, album, duration_ms, video_id FROM songs
            WHERE account_id = ? AND deleted = 0 AND id IN (${chunk.map(() => "?").join(", ")})`,
      args: [accountId, ...chunk],
    });
    for (const song of result.rows) {
      songs.set(String(song.id), {
        title: song.title,
        credit: song.credit,
        album: song.album,
        durationMs: song.duration_ms === null ? null : Number(song.duration_ms),
        videoId: song.video_id,
      });
    }
  }
  return rows.map((row) => {
    if (!inPlaylist(row)) return row;
    const songId = bare(row);
    const song = songId === null ? undefined : songs.get(songId);
    const filled =
      song === undefined
        ? row
        : { ...row, omitted: (row.omitted ?? []).filter((name) => !SONG_FIELDS.includes(name)) };
    const fields = { ...rowFields(table, row), ...song };
    return withFields(table, filled, collaborativeRow("playlistEntries", fields));
  });
};

interface EntryCount {
  readonly live: number;
  readonly all: number;
}

/** By playlist id, how many entries [accountId] holds in each of [playlistIds]: live, and in all. */
const entryCounts = async (
  tx: Transaction,
  accountId: string,
  playlistIds: readonly string[],
): Promise<Map<string, EntryCount>> => {
  const counts = new Map<string, EntryCount>();
  for (const chunk of chunks(playlistIds, IDS_PER_QUERY)) {
    const result = await tx.execute({
      sql: `SELECT playlist_id, sum(deleted = 0) AS live, count(*) AS n FROM playlist_entries
            WHERE account_id = ? AND playlist_id IN (${chunk.map(() => "?").join(", ")})
            GROUP BY playlist_id`,
      args: [accountId, ...chunk],
    });
    for (const row of result.rows) {
      counts.set(String(row.playlist_id), { live: Number(row.live ?? 0), all: Number(row.n) });
    }
  }
  return counts;
};

/** The limit of a collaborative playlist that going from [was] to [now] breaks, if any. */
const collaborativeLimitBroken = (
  was: EntryCount,
  now: EntryCount,
  limits: SyncLimits,
): SyncLimitName | null => {
  if (now.live > limits.maxCollaborativeSongs && now.live > was.live) {
    return "maxCollaborativeSongs";
  }
  if (now.all > limits.maxCollaborativeEntries && now.all > was.all) {
    return "maxCollaborativeEntries";
  }
  return null;
};

/** Merges [batch] into [accountId]'s rows in [tx], as [writerId]'s session wrote it (`pushRows`). */
const mergeAndStore = async (
  tx: Transaction,
  accountId: string,
  batch: PushBatch,
  limits: SyncLimits,
  now: number,
  writerId: string,
): Promise<PushResult> => {
  const accepted = new Map<SyncTable, readonly IncomingRow[]>();
  // Categories where the merge adds an ID: only these can go past a limit.
  const growing = new Set<SyncTable>();
  const corrected: Record<string, CorrectedRow[]> = {};
  const collaborative =
    batch.has(PLAYLISTS) || batch.has(ENTRIES)
      ? await ownedCollaborative(tx, accountId)
      : new Set<string>();
  // The collaborative playlists an accepted entry with its fields goes into.
  const touched = new Set<string>();
  // The owner's collaborative playlists this push deletes: their collaboration ends with it.
  const ending = new Set<string>();
  // Collaborative playlists the owner deleted, held or in this push: they take no live entry.
  const deleted =
    batch.has(ENTRIES) && collaborative.size > 0
      ? await deletedPlaylists(tx, accountId, [...collaborative])
      : new Set<string>();
  // The playlists first, so the entries know which of them this push deletes.
  const tables = [...batch].toSorted(
    ([a], [b]) => Number(b === PLAYLISTS) - Number(a === PLAYLISTS),
  );
  for (const [table, rows] of tables) {
    const given =
      table === ENTRIES && deleted.size > 0
        ? rows.filter((row) => {
            const playlistId = entryPlaylist(row);
            return row.deleted || playlistId === null || !deleted.has(playlistId);
          })
        : rows;
    if (given.length === 0) continue;
    const pushed = await asCollaborative(
      tx,
      accountId,
      table,
      given,
      collaborative,
      writerId === accountId,
    );
    const held = await heldRows(tx, table, accountId, [...new Set(pushed.map((row) => row.id))]);
    const sent = withKeptRestores(held, pushed);
    const incoming = table.kind === "rows" ? withinServiceClock(sent, now) : sent;
    const ahead = new Set(incoming.filter((row, i) => row !== sent[i]));
    const merged =
      table.kind === "rows"
        ? mergeTableRows(table.name, held, incoming).accepted
        : mergePlays(held, incoming).added;
    accepted.set(table, merged);
    const stored = merged.filter((row) => ahead.has(row));
    if (stored.length > 0) {
      corrected[table.name] = stored.map(({ id, changedAt }) => ({ id, changedAt }));
    }
    const heldIds = new Set(held.map((row) => row.id));
    if (merged.some((row) => !heldIds.has(row.id))) growing.add(table);
    if (table === PLAYLISTS && writerId === accountId) {
      for (const row of merged) {
        if (row.deleted && collaborative.has(row.id)) {
          ending.add(row.id);
          deleted.add(row.id);
        }
      }
    }
    if (table === ENTRIES) {
      for (const row of merged) {
        const playlistId = entryPlaylist(row);
        if (playlistId !== null && collaborative.has(playlistId)) touched.add(playlistId);
      }
    }
  }

  const total = [...accepted.values()].reduce((sum, rows) => sum + rows.length, 0);
  const counts = Object.fromEntries(
    SYNC_TABLES.map((table) => [table.name, accepted.get(table)?.length ?? 0]),
  );
  if (total === 0) return { accepted: counts, corrected };

  const before = await entryCounts(tx, accountId, [...touched]);
  const numbered = await tx.execute({
    sql: "UPDATE accounts SET change_seq = change_seq + ? WHERE id = ? RETURNING change_seq",
    args: [total, accountId],
  });
  let changeNo = Number(numbered.rows[0]?.change_seq) - total;
  const writes: InStatement[] = [];
  for (const [table, rows] of accepted) {
    for (const row of rows) writes.push(upsert(table, accountId, row, ++changeNo, writerId));
  }
  for (const playlistId of ending)
    writes.push(...endOwnedCollaboration(playlistId, accountId, now));
  await tx.batch(writes);

  for (const table of growing) {
    if ((await retainedRowCount(tx, table, accountId)) > limits[table.limit]) {
      await tx.rollback();
      return { overLimit: table.limit };
    }
  }
  // A playlist already past a limit still takes a push that doesn't raise its count.
  for (const [playlistId, count] of await entryCounts(tx, accountId, [...touched])) {
    const broken = collaborativeLimitBroken(
      before.get(playlistId) ?? { live: 0, all: 0 },
      count,
      limits,
    );
    if (broken !== null) {
      await tx.rollback();
      return { overLimit: broken };
    }
  }
  return { accepted: counts, corrected };
};

/**
 * Merges [batch] into [accountId]'s rows: each incoming change that wins
 * (Core's rules) is stored with the account's next change number. Nothing
 * is stored when a category that gains an ID would then retain more rows,
 * deletion records included, than [limits] allow. A category already past
 * its limit keeps its rows and still takes changes to the IDs it holds.
 * A change time ahead of [now], the service's clock, is stored as [now]
 * (Core's `withinServiceClock`), and the result names those rows.
 *
 * The rows of the account's collaborative playlists are kept as such a
 * playlist keeps them (`asCollaborative`), and nothing is stored when a push
 * takes one past `maxCollaborativeSongs` or `maxCollaborativeEntries`. A new
 * entry names the account as the one that added it.
 */
export const pushRows = (
  db: Client,
  accountId: string,
  batch: PushBatch,
  limits: SyncLimits,
  now: number,
): Promise<PushResult> =>
  inWriteTransaction(db, (tx) => mergeAndStore(tx, accountId, batch, limits, now, accountId));

/** Why a member's push of a playlist is refused. */
export type PlaylistPushRefusal =
  /** The playlist isn't collaborative, or the account isn't in it. */
  | { readonly refused: "not_member" }
  /** The owner deleted the playlist. */
  | { readonly refused: "deleted" }
  /** Only the owner deletes the playlist. */
  | { readonly refused: "not_owner" }
  /** The push holds something other than the playlist's row and entries. */
  | { readonly invalid: string };

/** Where the owner [ownerId] holds the entries [ids]: the playlist of each one held. */
const entryPlaces = async (
  tx: Transaction,
  ownerId: string,
  ids: readonly string[],
): Promise<Map<string, string | null>> => {
  const places = new Map<string, string | null>();
  for (const chunk of chunks(ids, IDS_PER_QUERY)) {
    const result = await tx.execute({
      sql: `SELECT id, playlist_id FROM playlist_entries
            WHERE account_id = ? AND id IN (${chunk.map(() => "?").join(", ")})`,
      args: [ownerId, ...chunk],
    });
    for (const row of result.rows) {
      places.set(String(row.id), typeof row.playlist_id === "string" ? row.playlist_id : null);
    }
  }
  return places;
};

/** What in [batch] isn't collaborative playlist [playlistId]'s to push for a member, if anything. */
const outsidePlaylist = (batch: PushBatch, playlistId: string): PlaylistPushRefusal | null => {
  for (const [table, rows] of batch) {
    if (table !== PLAYLISTS && table !== ENTRIES) {
      return { invalid: `${table.name} isn't this playlist's` };
    }
    if (table === PLAYLISTS && rows.some((row) => row.id !== playlistId)) {
      return { invalid: "playlists holds another playlist" };
    }
    if (table === PLAYLISTS && rows.some((row) => row.deleted)) return { refused: "not_owner" };
    if (
      table === ENTRIES &&
      rows.some((row) => row.values !== null && entryPlaylist(row) !== playlistId)
    ) {
      return { invalid: "playlistEntries holds another playlist's entry" };
    }
  }
  return null;
};

/**
 * A member's push of collaborative playlist [playlistId]: [batch] is merged
 * into the owner's rows as [accountId] wrote it, as `pushRows` merges, when
 * it holds only that playlist's row and entries. An entry the owner holds
 * outside the playlist, or in none, is dropped, and so is a removal of an
 * entry the service never held, since nothing says which playlist it was in.
 * The member's change to the playlist's row takes its name alone; its other
 * fields stay as stored (Core's `memberPlaylistFields`).
 */
export const pushPlaylistRows = (
  db: Client,
  playlistId: string,
  accountId: string,
  batch: PushBatch,
  limits: SyncLimits,
  now: number,
): Promise<PushResult | PlaylistPushRefusal> =>
  inWriteTransaction(db, async (tx) => {
    const [membership, held] = await tx.batch([
      {
        sql: `SELECT c.owner_id FROM collaborations c
              JOIN collaboration_members m ON m.playlist_id = c.playlist_id
              WHERE c.playlist_id = ? AND m.account_id = ?`,
        args: [playlistId, accountId],
      },
      {
        sql: `SELECT p.deleted FROM collaborations c
              JOIN playlists p ON p.account_id = c.owner_id AND p.id = c.playlist_id
              WHERE c.playlist_id = ?`,
        args: [playlistId],
      },
    ]);
    const ownerId = membership?.rows[0]?.owner_id;
    if (typeof ownerId !== "string") return { refused: "not_member" };
    if (Number(held?.rows[0]?.deleted ?? 1) === 1) return { refused: "deleted" };
    const outside = outsidePlaylist(batch, playlistId);
    if (outside !== null) return outside;

    const entries = batch.get(ENTRIES) ?? [];
    const places = await entryPlaces(tx, ownerId, [...new Set(entries.map((row) => row.id))]);
    const scoped = new Map(batch);
    if (entries.length > 0) {
      scoped.set(
        ENTRIES,
        entries.filter((row) => {
          const place = places.get(row.id);
          return place === undefined ? row.values !== null : place === playlistId;
        }),
      );
    }
    const renames = batch.get(PLAYLISTS) ?? [];
    if (renames.some((row) => row.values !== null)) {
      const stored = await tx.execute({
        sql: "SELECT * FROM playlists WHERE account_id = ? AND id = ?",
        args: [ownerId, playlistId],
      });
      const storedRow = stored.rows[0];
      if (storedRow !== undefined) {
        const storedFields = wireRow(PLAYLISTS, storedRow);
        scoped.set(
          PLAYLISTS,
          renames.map((row) =>
            withFields(
              PLAYLISTS,
              row,
              memberPlaylistFields(storedFields, rowFields(PLAYLISTS, row)),
            ),
          ),
        );
      }
    }
    return mergeAndStore(tx, ownerId, scoped, limits, now, accountId);
  });

/**
 * One page of a pull. Every page also says which collaborative playlists the
 * account is in now and which ended for it, whatever the cursor.
 */
export interface PulledPage extends Membership {
  /** The rows changed after the cursor asked for, by table name. */
  readonly rows: Readonly<Record<string, readonly Readonly<Record<string, unknown>>[]>>;
  /** The change number of the page's last row: the next pull's cursor. */
  readonly cursor: number;
  /** Whether more rows changed after it. */
  readonly more: boolean;
}

/** Up to [pageSize] of [accountId]'s rows changed after change number [since], oldest change first. */
export const pullRows = async (
  db: Client,
  accountId: string,
  since: number,
  pageSize: number,
): Promise<PulledPage> => {
  // One read transaction: every table is read in the same snapshot.
  const results = await db.batch(
    [
      ...SYNC_TABLES.map((table) => ({
        sql: `SELECT * FROM ${table.sqlName}
              WHERE account_id = ? AND change_no > ? ORDER BY change_no LIMIT ?`,
        args: [accountId, since, pageSize + 1],
      })),
      ...membershipStatements(accountId),
    ],
    "read",
  );
  const changed = SYNC_TABLES.flatMap((table, i) =>
    (results[i]?.rows ?? []).map((row) => ({ table, row, changeNo: Number(row.change_no) })),
  );
  // oxlint-disable-next-line unicorn/no-array-sort -- sorts a fresh array
  changed.sort((a, b) => a.changeNo - b.changeNo);
  const page = changed.slice(0, pageSize);
  const rows = Object.fromEntries(
    SYNC_TABLES.map((table) => [
      table.name,
      page.filter((change) => change.table === table).map((change) => wireRow(table, change.row)),
    ]),
  );
  return {
    rows,
    cursor: page.at(-1)?.changeNo ?? since,
    more: changed.length > pageSize,
    ...readMembership(results.slice(SYNC_TABLES.length), accountId),
  };
};

/** A page of one collaborative playlist's rows: its row and its entries. */
export interface PulledPlaylistPage {
  readonly rows: {
    readonly playlists: readonly Readonly<Record<string, unknown>>[];
    readonly playlistEntries: readonly Readonly<Record<string, unknown>>[];
  };
  /** The owner's change number of the page's last row: the next pull's cursor. */
  readonly cursor: number;
  /** The owner the change numbers are of, whom the next pull's cursor names. */
  readonly ownerId: string;
  /** Whether more rows changed after it. */
  readonly more: boolean;
}

/**
 * For [accountId], a member of collaborative playlist [playlistId], up to
 * [pageSize] of the playlist's row and entries changed after the owner's
 * change number [since], oldest change first, whoever wrote them. A cursor
 * taken under another owner ([sinceOwner], when it names one) starts from the
 * beginning, as the change numbers are another account's. Null when the
 * playlist isn't collaborative or the account isn't in it.
 */
export const pullPlaylistRows = async (
  db: Client,
  playlistId: string,
  accountId: string,
  since: number,
  sinceOwner: string | null,
  pageSize: number,
): Promise<PulledPlaylistPage | null> => {
  const owner = `(SELECT c.owner_id FROM collaborations c
                  JOIN collaboration_members m ON m.playlist_id = c.playlist_id
                  WHERE c.playlist_id = ? AND m.account_id = ?)`;
  const ownerArgs = [playlistId, accountId];
  const after = `(CASE WHEN coalesce(?, ${owner}) = ${owner} THEN ? ELSE 0 END)`;
  const afterArgs = [sinceOwner, ...ownerArgs, ...ownerArgs, since];
  // One read transaction: the membership and the rows in the same snapshot.
  const [membership, playlists, entries] = await db.batch(
    [
      { sql: `SELECT ${owner} AS owner_id, ${after} AS since`, args: [...ownerArgs, ...afterArgs] },
      {
        sql: `SELECT * FROM playlists WHERE account_id = ${owner} AND id = ? AND change_no > ${after}`,
        args: [...ownerArgs, playlistId, ...afterArgs],
      },
      {
        sql: `SELECT * FROM playlist_entries
              WHERE account_id = ${owner} AND playlist_id = ? AND change_no > ${after}
              ORDER BY change_no LIMIT ?`,
        args: [...ownerArgs, playlistId, ...afterArgs, pageSize + 1],
      },
    ],
    "read",
  );
  const ownerId = membership?.rows[0]?.owner_id;
  if (typeof ownerId !== "string") return null;
  const changed = [
    ...(playlists?.rows ?? []).map((row) => ({ table: PLAYLISTS, row })),
    ...(entries?.rows ?? []).map((row) => ({ table: ENTRIES, row })),
  ];
  // oxlint-disable-next-line unicorn/no-array-sort -- sorts a fresh array
  changed.sort((a, b) => Number(a.row.change_no) - Number(b.row.change_no));
  const page = changed.slice(0, pageSize);
  const of = (table: SyncTable) =>
    page.filter((change) => change.table === table).map((change) => wireRow(table, change.row));
  return {
    rows: { playlists: of(PLAYLISTS), playlistEntries: of(ENTRIES) },
    cursor: Number(page.at(-1)?.row.change_no ?? membership?.rows[0]?.since ?? since),
    ownerId,
    more: changed.length > pageSize,
  };
};

/**
 * Moves [playlistId]'s playlist row and every entry that names it, Graveyard
 * ones included, from [from]'s rows to [to]'s, numbered as [to]'s next changes so
 * its ordinary pull carries them. A row [to] held with the same id is
 * replaced. They count in [to]'s caps from then on, even past them.
 */
const moveCollaborativePlaylist = async (
  tx: Transaction,
  playlistId: string,
  from: string,
  to: string,
): Promise<void> => {
  const counted = await tx.execute({
    sql: `SELECT (SELECT count(*) FROM playlists WHERE account_id = ? AND id = ?) AS playlists,
                 (SELECT count(*) FROM playlist_entries
                  WHERE account_id = ? AND playlist_id = ?) AS entries`,
    args: [from, playlistId, from, playlistId],
  });
  const playlists = Number(counted.rows[0]?.playlists ?? 0);
  const total = playlists + Number(counted.rows[0]?.entries ?? 0);
  if (total === 0) return;
  const numbered = await tx.execute({
    sql: "UPDATE accounts SET change_seq = change_seq + ? WHERE id = ? RETURNING change_seq",
    args: [total, to],
  });
  const first = Number(numbered.rows[0]?.change_seq) - total;
  await tx.batch([
    {
      sql: "UPDATE playlists SET change_no = ? WHERE account_id = ? AND id = ?",
      args: [first + 1, from, playlistId],
    },
    {
      sql: `UPDATE playlist_entries SET change_no = ? + ranked.n
            FROM (SELECT id, row_number() OVER (ORDER BY change_no, id) AS n
                  FROM playlist_entries WHERE account_id = ? AND playlist_id = ?) AS ranked
            WHERE playlist_entries.account_id = ? AND playlist_entries.id = ranked.id`,
      args: [first + playlists, from, playlistId, from],
    },
    {
      sql: "UPDATE OR REPLACE playlists SET account_id = ? WHERE account_id = ? AND id = ?",
      args: [to, from, playlistId],
    },
    {
      sql: `UPDATE OR REPLACE playlist_entries SET account_id = ?
            WHERE account_id = ? AND playlist_id = ?`,
      args: [to, from, playlistId],
    },
  ]);
};

/**
 * Deletes every row and session of [accountId], and the account. Each
 * collaborative playlist it owns passes, with its rows, to the member who
 * joined first, or goes with the account when no other member is left; it
 * leaves the ones it is in.
 */
export const deleteAccount = (db: Client, accountId: string): Promise<void> =>
  inWriteTransaction(db, async (tx) => {
    for (const { playlistId, heir } of await ownedCollaborations(tx, accountId)) {
      if (heir === null) continue;
      await moveCollaborativePlaylist(tx, playlistId, accountId, heir);
      await tx.execute(passCollaboration(playlistId, heir));
    }
    await tx.batch([
      ...SYNC_TABLES.map((table) => ({
        sql: `DELETE FROM ${table.sqlName} WHERE account_id = ?`,
        args: [accountId],
      })),
      { sql: "DELETE FROM soulseek_accounts WHERE account_id = ?", args: [accountId] },
      { sql: "DELETE FROM sessions WHERE account_id = ?", args: [accountId] },
      { sql: "DELETE FROM upstream_usage WHERE account_id = ?", args: [accountId] },
      ...forgetAccountStatements(accountId),
      {
        sql: `DELETE FROM sign_in_windows
              WHERE key = (SELECT 'sub:' || google_sub FROM accounts WHERE id = ?)`,
        args: [accountId],
      },
      { sql: "DELETE FROM accounts WHERE id = ?", args: [accountId] },
    ]);
  });
