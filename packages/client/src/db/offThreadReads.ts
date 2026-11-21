/**
 * Library reads off the JS thread (#1348).
 *
 * Every query module is written against Drizzle's synchronous SQLite API, so a
 * read is a plain function of a `LibraryDatabase`. `replayRead` runs that same
 * function against a database whose statements answer from rows already
 * fetched: the first statement it hasn't seen stops the pass, that statement
 * runs on a separate connection through its asynchronous API (SQLite works on
 * a native thread meanwhile), and the read runs again from the top with one
 * more answer. JS only builds queries and turns rows into values; a read of k
 * statements runs k + 1 short passes. All of a read's statements run inside
 * one transaction on its read connection, so they see one snapshot, as the
 * synchronous read did.
 *
 * A read that writes, asks the connection about itself (a PRAGMA), or doesn't
 * settle (its statements change between passes) can't be replayed: it rejects
 * with `NotReplayable` and the caller runs it on the main connection.
 */
import * as drizzleOrm from "drizzle-orm";
import {
  createTableRelationsHelpers,
  entityKind,
  extractTablesRelationalConfig,
  fillPlaceholders,
  type Query,
} from "drizzle-orm";
import {
  BaseSQLiteDatabase,
  SQLitePreparedQuery,
  SQLiteSession,
  SQLiteSyncDialect,
  SQLiteTransaction,
  type SQLiteExecuteMethod,
} from "drizzle-orm/sqlite-core";

import type { LibraryDatabase } from "./database.ts";
import * as schema from "./schema.ts";

/** A value bound to a statement, as Drizzle hands it to the driver. */
export type ReadParam = string | number | boolean | null | Uint8Array;

/** How a statement's rows come back: as column-keyed objects or as value arrays. */
export type ReadMode = "objects" | "values";

export interface ReadStatement {
  readonly sql: string;
  readonly params: readonly ReadParam[];
  readonly mode: ReadMode;
}

/** One read's statements, run in order inside one transaction. */
export type ReadSnapshot = (statement: ReadStatement) => Promise<readonly unknown[]>;

/** Where replayed reads fetch their rows. */
export interface ReadConnection {
  readonly snapshot: <A>(inSnapshot: (query: ReadSnapshot) => Promise<A>) => Promise<A>;
}

/** The part of expo-sqlite's asynchronous connection a read connection uses. */
export interface AsyncSqliteResult<Row> {
  getAllAsync(): Promise<Row[]>;
}
export interface AsyncSqliteStatement {
  executeAsync(params: ReadParam[]): Promise<AsyncSqliteResult<unknown>>;
  executeForRawResultAsync(params: ReadParam[]): Promise<AsyncSqliteResult<unknown[]>>;
  finalizeAsync(): Promise<void>;
}
export interface AsyncSqlite {
  execAsync(statements: string): Promise<void>;
  prepareAsync(sql: string): Promise<AsyncSqliteStatement>;
}

/** Why a read ran on the main connection instead. */
export class NotReplayable extends Error {}

/** A statement the pass hasn't got rows for yet. */
class Miss {
  readonly key: string;
  readonly statement: ReadStatement;
  constructor(key: string, statement: ReadStatement) {
    this.key = key;
    this.statement = statement;
  }
}

/** Passes before a read counts as not settling (its statements keep changing). */
const MAX_PASSES = 512;

// Transaction control the replayed read issues itself (Drizzle's `transaction`):
// the whole read already runs inside the snapshot's transaction.
const CONTROL = /^\s*(begin|commit|end|rollback|savepoint|release)\b/i;
// Only these read rows without touching the connection's own state.
const READ = /^\s*(select|with|values)\b/i;
// Functions that answer about this connection rather than the database.
const CONNECTION_STATE = /\b(changes|total_changes|last_insert_rowid)\s*\(/i;

const keyParam = (_key: string, value: unknown): unknown =>
  typeof value === "bigint"
    ? `${value}n`
    : value instanceof Uint8Array
      ? `blob:${Array.from(value).join(",")}`
      : value;

const keyOf = (statement: ReadStatement): string =>
  `${statement.mode}\u0000${statement.sql}\u0000${JSON.stringify(statement.params, keyParam)}`;

/** The rows of the pass running now. Passes are synchronous, so one at a time. */
let answers: Map<string, readonly unknown[]> | null = null;

const answer = (sql: string, params: readonly ReadParam[], mode: ReadMode) => {
  if (answers === null) throw new NotReplayable("a replayed statement ran outside its pass");
  if (!READ.test(sql) || CONNECTION_STATE.test(sql))
    throw new NotReplayable(`not a plain read: ${sql.slice(0, 40)}`);
  const statement = { sql, params: [...params], mode };
  const key = keyOf(statement);
  const rows = answers.get(key);
  if (rows === undefined) throw new Miss(key, statement);
  return rows;
};

// The replay's Drizzle session, the expo-sqlite driver's (drizzle-orm 0.45) with its
// statements answered from the pass's rows: results are shaped exactly as on the phone's
// main connection. Drizzle's transactions are no-ops here, since the whole read already
// runs inside the snapshot's transaction.
type Row = Record<string, unknown>;
type Fields = Parameters<SQLiteSession<"sync", unknown, Row, never>["prepareQuery"]>[1];
type ResultMapper = (rows: unknown[][]) => unknown;
const { mapResultRow } = drizzleOrm as unknown as {
  mapResultRow: (fields: Fields, row: unknown[], joins: unknown) => unknown;
};

class ReplayPreparedQuery extends SQLitePreparedQuery<{
  type: "sync";
  run: void;
  all: unknown;
  get: unknown;
  values: unknown;
  execute: unknown;
}> {
  static override readonly [entityKind]: string = "WaveReplayPreparedQuery";
  /** Drizzle sets this after construction. Read through a cast: Metro's Babel rejects `declare` fields. */
  private joins(): Record<string, boolean> | undefined {
    return (this as unknown as { joinsNotNullableMap?: Record<string, boolean> })
      .joinsNotNullableMap;
  }
  private readonly fields: Fields;
  private readonly arrayMode: boolean;
  private readonly customResultMapper: ResultMapper | undefined;

  constructor(
    query: Query,
    fields: Fields,
    executeMethod: SQLiteExecuteMethod,
    arrayMode: boolean,
    customResultMapper: ResultMapper | undefined,
  ) {
    super("sync", executeMethod, query);
    this.fields = fields;
    this.arrayMode = arrayMode;
    this.customResultMapper = customResultMapper;
  }

  private params(placeholderValues?: Record<string, unknown>): ReadParam[] {
    return fillPlaceholders(this.query.params, placeholderValues ?? {}) as ReadParam[];
  }

  override run(placeholderValues?: Record<string, unknown>): void {
    if (CONTROL.test(this.query.sql)) return;
    answer(this.query.sql, this.params(placeholderValues), "objects");
  }

  override all(placeholderValues?: Record<string, unknown>): unknown {
    const { fields, customResultMapper } = this;
    if (!fields && !customResultMapper)
      return [...answer(this.query.sql, this.params(placeholderValues), "objects")];
    const rows = this.values(placeholderValues);
    if (customResultMapper) return customResultMapper(rows);
    return rows.map((row) => mapResultRow(fields, row, this.joins()));
  }

  override get(placeholderValues?: Record<string, unknown>): unknown {
    const { fields, customResultMapper } = this;
    if (!fields && !customResultMapper)
      return answer(this.query.sql, this.params(placeholderValues), "objects")[0] ?? null;
    const row = this.values(placeholderValues)[0];
    if (!row) return undefined;
    if (customResultMapper) return customResultMapper([row]);
    return mapResultRow(fields, row, this.joins());
  }

  override values(placeholderValues?: Record<string, unknown>): unknown[][] {
    return [...answer(this.query.sql, this.params(placeholderValues), "values")] as unknown[][];
  }

  /** @internal */
  isResponseInArrayMode(): boolean {
    return this.arrayMode;
  }
}

class ReplayTransaction extends SQLiteTransaction<"sync", unknown, Row, never> {
  static override readonly [entityKind]: string = "WaveReplayTransaction";
  // A nested transaction is a savepoint on the phone; a read has nothing to roll back.
  override transaction<T>(transaction: (tx: ReplayTransaction) => T): T {
    return transaction(this);
  }
}

class ReplaySession extends SQLiteSession<"sync", unknown, Row, never> {
  static override readonly [entityKind]: string = "WaveReplaySession";
  private readonly replayDialect: SQLiteSyncDialect;
  private readonly schemaConfig: unknown;
  constructor(dialect: SQLiteSyncDialect, schemaConfig: unknown) {
    super(dialect);
    this.replayDialect = dialect;
    this.schemaConfig = schemaConfig;
  }
  override prepareQuery(
    query: Query,
    fields: Fields,
    executeMethod: SQLiteExecuteMethod,
    isResponseInArrayMode: boolean,
    customResultMapper?: ResultMapper,
  ) {
    return new ReplayPreparedQuery(
      query,
      fields,
      executeMethod,
      isResponseInArrayMode,
      customResultMapper,
    ) as never;
  }
  override transaction<T>(transaction: (tx: ReplayTransaction) => T): T {
    return transaction(
      new ReplayTransaction("sync", this.replayDialect, this, this.schemaConfig as never),
    );
  }
}

let replayDatabase: LibraryDatabase | null = null;
/** One Drizzle database for every pass: building its schema map is the costly part. */
const replayDb = (): LibraryDatabase => {
  if (replayDatabase !== null) return replayDatabase;
  const dialect = new SQLiteSyncDialect();
  const tables = extractTablesRelationalConfig(schema, createTableRelationsHelpers);
  const schemaConfig = {
    fullSchema: schema,
    schema: tables.tables,
    tableNamesMap: tables.tableNamesMap,
  };
  replayDatabase = new BaseSQLiteDatabase(
    "sync",
    dialect,
    new ReplaySession(dialect, schemaConfig) as never,
    schemaConfig as never,
  ) as unknown as LibraryDatabase;
  return replayDatabase;
};

/** The replay's own signal under [error], which Drizzle may have wrapped (its `run`). */
const replayReason = (error: unknown): Miss | NotReplayable | null => {
  for (let at = error, depth = 0; at instanceof Object && depth < 8; depth++) {
    if (at instanceof Miss || at instanceof NotReplayable) return at;
    at = (at as { cause?: unknown }).cause;
  }
  return null;
};

export interface ReplayedRead<A> {
  readonly value: A;
  /** The JS thread's time in the read's passes, in ms: building queries and mapping rows. */
  readonly heldMs: number;
  /** How many statements went to the read connection. */
  readonly statements: number;
}

/** Runs [read] with its statements on [connection], as described at the top. */
export const replayRead = <A>(
  connection: ReadConnection,
  read: (db: LibraryDatabase) => A,
  now: () => number,
): Promise<ReplayedRead<A>> =>
  connection.snapshot(async (query) => {
    const rows = new Map<string, readonly unknown[]>();
    let heldMs = 0;
    for (let pass = 0; pass < MAX_PASSES; pass++) {
      const start = now();
      let missed: Miss;
      answers = rows;
      try {
        const value = read(replayDb());
        return { value, heldMs: heldMs + now() - start, statements: rows.size };
      } catch (error) {
        const reason = replayReason(error);
        if (reason === null) throw error;
        if (reason instanceof NotReplayable) throw reason;
        missed = reason;
      } finally {
        answers = null;
        heldMs += now() - start;
      }
      rows.set(missed.key, await query(missed.statement));
    }
    throw new NotReplayable(`a read didn't settle in ${MAX_PASSES} passes`);
  });

/** Statements kept prepared per connection. */
const STATEMENTS_KEPT = 64;

/** One connection, one snapshot at a time; it opens on its first read. */
const lane = (open: () => Promise<AsyncSqlite>) => {
  let opened: Promise<AsyncSqlite> | null = null;
  let tail: Promise<unknown> = Promise.resolve();
  let waiting = 0;
  const statements = new Map<string, Promise<AsyncSqliteStatement>>();

  const prepared = (db: AsyncSqlite, sql: string) => {
    const kept = statements.get(sql);
    if (kept !== undefined) {
      statements.delete(sql);
      statements.set(sql, kept);
      return kept;
    }
    const made = db.prepareAsync(sql);
    // A statement that failed to prepare isn't kept: the next read prepares it again.
    made.catch(() => statements.delete(sql));
    statements.set(sql, made);
    if (statements.size > STATEMENTS_KEPT) {
      const [oldest, statement] = statements.entries().next().value!;
      statements.delete(oldest);
      // Only one snapshot runs at a time and each statement was read to its end.
      void statement.then((s) => s.finalizeAsync()).catch(() => {});
    }
    return made;
  };

  const run = async <A>(inSnapshot: (query: ReadSnapshot) => Promise<A>): Promise<A> => {
    opened ??= open().catch((error: unknown) => {
      opened = null;
      throw error;
    });
    const db = await opened;
    await db.execAsync("BEGIN");
    let result: A;
    try {
      result = await inSnapshot(async ({ sql, params, mode }) => {
        const statement = await prepared(db, sql);
        const executed =
          mode === "values"
            ? await statement.executeForRawResultAsync([...params])
            : await statement.executeAsync([...params]);
        return executed.getAllAsync();
      });
    } catch (error) {
      await db.execAsync("ROLLBACK").catch(() => {});
      throw error;
    }
    await db.execAsync("COMMIT");
    return result;
  };

  return {
    get waiting() {
      return waiting;
    },
    snapshot: <A>(inSnapshot: (query: ReadSnapshot) => Promise<A>): Promise<A> => {
      waiting++;
      const result = tail.then(() => run(inSnapshot));
      tail = result.then(
        () => (waiting--, undefined),
        () => (waiting--, undefined),
      );
      return result;
    },
  };
};

/**
 * [size] read connections, each opened by [open] on first use; a read goes to
 * the one with the fewest reads waiting, so a long read doesn't hold up the rest.
 */
export const readConnections = (open: () => Promise<AsyncSqlite>, size = 2): ReadConnection => {
  const lanes = Array.from({ length: size }, () => lane(open));
  return {
    snapshot: (inSnapshot) => {
      let best = lanes[0]!;
      for (const candidate of lanes) if (candidate.waiting < best.waiting) best = candidate;
      return best.snapshot(inSnapshot);
    },
  };
};

/** Settings for a read connection: it never writes, and keeps a smaller page cache. */
export const READ_CONNECTION_SETTINGS = [
  "PRAGMA query_only = ON",
  "PRAGMA temp_store = MEMORY",
  "PRAGMA cache_size = -4096",
  "PRAGMA mmap_size = 67108864",
]
  .map((statement) => `${statement};`)
  .join(" ");
