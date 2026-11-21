/**
 * Reading and writing an account's synced rows. A push merges by Core's
 * rules (`mergeTableRows`, `mergePlays`), so the service and the app can't
 * disagree, and numbers each accepted change in the same transaction that
 * writes it: a pull reads in one snapshot and pages by those numbers, so it
 * never misses a change pushed while it runs.
 */

import type { Client, InStatement, InValue, Transaction } from "@libsql/client";
import { mergePlays, mergeTableRows, withinServiceClock } from "@wave/core";
import type { SyncLimitName, SyncLimits } from "./limits.ts";
import { type IncomingRow, type SyncTable, SYNC_TABLES, column, wireRow } from "./tables.ts";

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

/**
 * Merges [batch] into [accountId]'s rows: each incoming change that wins
 * (Core's rules) is stored with the account's next change number. Nothing
 * is stored when a category that gains an ID would then retain more rows,
 * deletion records included, than [limits] allow. A category already past
 * its limit keeps its rows and still takes changes to the IDs it holds.
 * A change time ahead of [now], the service's clock, is stored as [now]
 * (Core's `withinServiceClock`), and the result names those rows.
 */
export const pushRows = (
  db: Client,
  accountId: string,
  batch: PushBatch,
  limits: SyncLimits,
  now: number,
): Promise<PushResult> =>
  inWriteTransaction(db, async (tx) => {
    const accepted = new Map<SyncTable, readonly IncomingRow[]>();
    // Categories where the merge adds an ID: only these can go past a limit.
    const growing = new Set<SyncTable>();
    const corrected: Record<string, CorrectedRow[]> = {};
    for (const [table, pushed] of batch) {
      if (pushed.length === 0) continue;
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
    }

    const total = [...accepted.values()].reduce((sum, rows) => sum + rows.length, 0);
    const counts = Object.fromEntries(
      SYNC_TABLES.map((table) => [table.name, accepted.get(table)?.length ?? 0]),
    );
    if (total === 0) return { accepted: counts, corrected };

    const numbered = await tx.execute({
      sql: "UPDATE accounts SET change_seq = change_seq + ? WHERE id = ? RETURNING change_seq",
      args: [total, accountId],
    });
    let changeNo = Number(numbered.rows[0]?.change_seq) - total;
    const writes: InStatement[] = [];
    for (const [table, rows] of accepted) {
      for (const row of rows) writes.push(upsert(table, accountId, row, ++changeNo));
    }
    await tx.batch(writes);

    for (const table of growing) {
      if ((await retainedRowCount(tx, table, accountId)) > limits[table.limit]) {
        await tx.rollback();
        return { overLimit: table.limit };
      }
    }
    return { accepted: counts, corrected };
  });

/** One page of a pull. */
export interface PulledPage {
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
    SYNC_TABLES.map((table) => ({
      sql: `SELECT * FROM ${table.sqlName}
            WHERE account_id = ? AND change_no > ? ORDER BY change_no LIMIT ?`,
      args: [accountId, since, pageSize + 1],
    })),
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
  return { rows, cursor: page.at(-1)?.changeNo ?? since, more: changed.length > pageSize };
};

/** Deletes every row and session of [accountId], and the account. */
export const deleteAccount = async (db: Client, accountId: string): Promise<void> => {
  await db.batch(
    [
      ...SYNC_TABLES.map((table) => ({
        sql: `DELETE FROM ${table.sqlName} WHERE account_id = ?`,
        args: [accountId],
      })),
      { sql: "DELETE FROM soulseek_accounts WHERE account_id = ?", args: [accountId] },
      { sql: "DELETE FROM sessions WHERE account_id = ?", args: [accountId] },
      { sql: "DELETE FROM upstream_usage WHERE account_id = ?", args: [accountId] },
      {
        sql: `DELETE FROM sign_in_windows
              WHERE key = (SELECT 'sub:' || google_sub FROM accounts WHERE id = ?)`,
        args: [accountId],
      },
      { sql: "DELETE FROM accounts WHERE id = ?", args: [accountId] },
    ],
    "write",
  );
};
