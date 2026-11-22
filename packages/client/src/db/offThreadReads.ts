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
 * Mapping rows into values is most of a large read's JS time (3,000 songs held
 * the thread for seconds when every pass mapped every row again, #1435). So a
 * statement's rows are mapped once per read and kept for the passes after, and
 * a large result is mapped in steps of `REPLAY_STEP_MS` that yield between
 * them: no step of a replay holds the thread long, whatever the read's size.
 * Each pass hands a read its own array, but the row objects are shared across
 * passes, so a replayed read never mutates the rows it reads (none does).
 *
 * A read runs again and again (Home's mix builds read the same 20,000 rows
 * several times a second on the reference phone, #1452), and each of its k
 * statements used to cost a pass that redid everything before it. So a read
 * (the same function) fetches the statements it ran last time before its
 * first pass, and maps their large results in steps: a read whose statements
 * haven't changed runs each of them once, in one pass. A statement that
 * changes on every run (a time in its params) stops being fetched ahead once
 * two runs disagree on it. `sharedReplays` also lets callers that ask for the
 * same read at once share one replay.
 *
 * A read that writes, asks the connection about itself (a PRAGMA), or doesn't
 * settle (its statements change between passes) can't be replayed: it rejects
 * with `NotReplayable` and the caller runs it on the main connection.
 */
import * as drizzleOrm from "drizzle-orm";
import {
  Column,
  createTableRelationsHelpers,
  entityKind,
  extractTablesRelationalConfig,
  fillPlaceholders,
  is,
  SQL,
  Subquery,
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

/** The longest a step of mapping rows holds the JS thread, in ms (background work's slice). */
export const REPLAY_STEP_MS = 8;

/** Rows a pass maps itself; a statement with more is mapped in steps between passes. */
const MAPPED_IN_PASS = 200;

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

interface MappedRows {
  readonly print: Print;
  readonly rows: readonly unknown[];
  /** Mapped ahead of the read's first pass, as the read mapped them last time. */
  readonly ahead?: boolean;
}

/** How a statement's rows were mapped into values: what maps them again ahead of a pass. */
interface Mapping {
  readonly fields: Fields;
  readonly joins: Record<string, boolean> | undefined;
  readonly print: Print;
}

/** A statement a pass asked for, and how it mapped its rows (none for raw rows). */
interface Asked {
  readonly statement: ReadStatement;
  mapping?: Mapping;
}

/** What a pass answers from: the read's rows so far, and the rows it has mapped. */
interface Pass {
  readonly rows: Map<string, readonly unknown[]>;
  readonly mapped: Map<string, MappedRows>;
  /** Statements whose kept rows this pass already handed out: asked again, it maps afresh. */
  readonly handed: Set<string>;
  /** Every statement this pass got rows for, in the order it asked. */
  readonly asked: Map<string, Asked>;
}

/** The pass running now. Passes are synchronous, so one at a time. */
let current: Pass | null = null;

const answer = (sql: string, params: readonly ReadParam[], mode: ReadMode) => {
  if (current === null) throw new NotReplayable("a replayed statement ran outside its pass");
  if (!READ.test(sql) || CONNECTION_STATE.test(sql))
    throw new NotReplayable(`not a plain read: ${sql.slice(0, 40)}`);
  const statement = { sql, params: [...params], mode };
  const key = keyOf(statement);
  const rows = current.rows.get(key);
  if (rows === undefined) throw new Miss(key, statement);
  if (!current.asked.has(key)) current.asked.set(key, { statement });
  return { key, rows };
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

/**
 * What tells two selections' mappings apart: each value's path and decoder, and the joins
 * that null a left-joined table. The same statement mapped with the same print gives the
 * same values, so its mapped rows serve every pass that asks for it that way.
 */
type Print = readonly unknown[];

/** A decoder's identity: a `mapWith(fn)` wraps [fn] anew in each pass, so it's the function. */
const decoderOf = (decoder: { mapFromDriverValue: unknown }): unknown =>
  Object.getPrototypeOf(decoder) === Object.prototype ? decoder.mapFromDriverValue : decoder;

/** A SQL value's decoder, which drizzle keeps off its public type. */
const sqlDecoder = (value: SQL): unknown =>
  decoderOf((value as unknown as { decoder: { mapFromDriverValue: unknown } }).decoder);

const printOf = (fields: Fields, joins: Record<string, boolean> | undefined): Print => {
  const print: unknown[] = [joins === undefined ? "" : JSON.stringify(joins)];
  for (const { path, field } of fields as unknown as readonly {
    path: string[];
    field: unknown;
  }[]) {
    print.push(path.join("\u0000"));
    if (is(field, Column)) print.push(field);
    else if (is(field, SQL)) print.push(sqlDecoder(field));
    else if (is(field, Subquery)) print.push(sqlDecoder(field._.sql));
    else print.push(sqlDecoder((field as SQL.Aliased).sql));
  }
  return print;
};

const samePrint = (a: Print, b: Print): boolean =>
  a.length === b.length && a.every((part, at) => part === b[at]);

/** A statement's rows, too many to map inside a pass: the replay maps them in steps. */
class Unmapped {
  readonly key: string;
  readonly rows: readonly unknown[][];
  readonly fields: Fields;
  readonly joins: Record<string, boolean> | undefined;
  readonly print: Print;
  constructor(
    key: string,
    rows: readonly unknown[][],
    fields: Fields,
    joins: Record<string, boolean> | undefined,
    print: Print,
  ) {
    this.key = key;
    this.rows = rows;
    this.fields = fields;
    this.joins = joins;
    this.print = print;
  }
}

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
      return [...answer(this.query.sql, this.params(placeholderValues), "objects").rows];
    if (customResultMapper) return customResultMapper(this.values(placeholderValues));
    const { key, rows } = answer(this.query.sql, this.params(placeholderValues), "values");
    const pass = current!;
    const joins = this.joins();
    const print = printOf(fields, joins);
    pass.asked.get(key)!.mapping ??= { fields, joins, print };
    let kept = pass.mapped.get(key);
    // Rows mapped ahead another way than this read maps them now are mapped again, as if new.
    if (kept?.ahead === true && !samePrint(kept.print, print)) {
      pass.mapped.delete(key);
      kept = undefined;
    }
    const fresh = !pass.handed.has(key);
    pass.handed.add(key);
    if (kept !== undefined && fresh && samePrint(kept.print, print)) return [...kept.rows];
    const raw = rows as readonly unknown[][];
    // Rows asked for again in one pass, or with another mapping, are mapped here and not kept.
    if (kept === undefined && raw.length > MAPPED_IN_PASS)
      throw new Unmapped(key, raw, fields, joins, print);
    const mapped = raw.map((row) => mapResultRow(fields, row, joins));
    if (kept === undefined) pass.mapped.set(key, { print, rows: mapped });
    return [...mapped];
  }

  override get(placeholderValues?: Record<string, unknown>): unknown {
    const { fields, customResultMapper } = this;
    if (!fields && !customResultMapper)
      return answer(this.query.sql, this.params(placeholderValues), "objects").rows[0] ?? null;
    const row = this.values(placeholderValues)[0];
    if (!row) return undefined;
    if (customResultMapper) return customResultMapper([row]);
    return mapResultRow(fields, row, this.joins());
  }

  override values(placeholderValues?: Record<string, unknown>): unknown[][] {
    return [
      ...answer(this.query.sql, this.params(placeholderValues), "values").rows,
    ] as unknown[][];
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
const replayReason = (error: unknown): Miss | Unmapped | NotReplayable | null => {
  for (let at = error, depth = 0; at instanceof Object && depth < 8; depth++) {
    if (at instanceof Miss || at instanceof Unmapped || at instanceof NotReplayable) return at;
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

/** Runs a replay step: as it is, unless the app names it (`runReplayPassesWith`). */
let replayPass: <B>(run: () => B) => B = (run) => run();

/**
 * Runs each replay step (a pass, or a step of mapping rows) through [runner], which the app
 * uses to name the JS thread's block after the read's last answer arrives (#1359).
 */
export const runReplayPassesWith = (runner: <B>(run: () => B) => B): void => {
  replayPass = runner;
};

/** Gives the JS thread up between steps of mapping rows: a new task, so frames and touches go first. */
let yieldReplay: () => Promise<void> = () => new Promise((resolve) => setTimeout(resolve, 0));

/** Yields between steps of mapping rows with [yielder] instead of a new task (tests). */
export const yieldReplaysWith = (yielder: () => Promise<void>): void => {
  yieldReplay = yielder;
};

/** Maps [rows] in steps of `REPLAY_STEP_MS` at most, yielding between them. */
const mapInSteps = async (
  rows: readonly unknown[][],
  { fields, joins }: Pick<Mapping, "fields" | "joins">,
  now: () => number,
) => {
  const out: unknown[] = [];
  let heldMs = 0;
  while (out.length < rows.length) {
    const start = now();
    replayPass(() => {
      do out.push(mapResultRow(fields, rows[out.length]!, joins));
      while (out.length < rows.length && now() - start < REPLAY_STEP_MS);
    });
    heldMs += now() - start;
    if (out.length < rows.length) await yieldReplay();
  }
  return { rows: out, heldMs };
};

/**
 * Runs [steps] (a read's working out, built as Core's steps) in slices of
 * `REPLAY_STEP_MS` at most, as replay steps, yielding between them, so the
 * work after a replayed read holds the thread no longer than its mapping.
 * Gives the value and the JS thread's time in the slices.
 */
export const finishReplaySteps = async <A>(
  steps: Generator<void, A>,
  now: () => number,
): Promise<{ readonly value: A; readonly heldMs: number }> => {
  let heldMs = 0;
  for (;;) {
    const start = now();
    const next = replayPass(() => {
      let step = steps.next();
      while (!step.done && now() - start < REPLAY_STEP_MS) step = steps.next();
      return step;
    });
    heldMs += now() - start;
    if (next.done) return { value: next.value, heldMs };
    await yieldReplay();
  }
};

/** What a read fetches before its first pass: what it asked for last time, and before that. */
interface Plan {
  /** The statements the read's last run asked for. */
  readonly last: ReadonlySet<string>;
  /** Those its last two runs both asked for (all of them after its first): fetched ahead. */
  readonly ahead: readonly (readonly [string, Asked])[];
}

/** Each read's plan, by its function: a read made for one call (its own params) has none. */
const plans = new WeakMap<object, Plan>();

/** Keeps what [read]'s run just [asked] for as its next plan. */
const learn = (read: object, asked: ReadonlyMap<string, Asked>): void => {
  const before = plans.get(read);
  plans.set(read, {
    last: new Set(asked.keys()),
    ahead: [...asked].filter(([key]) => before === undefined || before.last.has(key)),
  });
};

/** Runs [read] with its statements on [connection], as described at the top. */
export const replayRead = <A>(
  connection: ReadConnection,
  read: (db: LibraryDatabase) => A,
  now: () => number,
): Promise<ReplayedRead<A>> =>
  connection.snapshot(async (query) => {
    const rows = new Map<string, readonly unknown[]>();
    const mapped = new Map<string, MappedRows>();
    let heldMs = 0;
    for (const [key, { statement, mapping }] of plans.get(read)?.ahead ?? []) {
      // A statement fetched ahead that fails is left to the pass that asks for it, if any.
      const fetched = await query(statement).catch(() => null);
      if (fetched === null) continue;
      rows.set(key, fetched);
      if (mapping === undefined || fetched.length <= MAPPED_IN_PASS) continue;
      const done = await mapInSteps(fetched as readonly unknown[][], mapping, now);
      heldMs += done.heldMs;
      mapped.set(key, { print: mapping.print, rows: done.rows, ahead: true });
    }
    for (let pass = 0; pass < MAX_PASSES; pass++) {
      const start = now();
      let stopped: Miss | Unmapped;
      const asked = new Map<string, Asked>();
      current = { rows, mapped, handed: new Set(), asked };
      try {
        const value = replayPass(() => read(replayDb()));
        learn(read, asked);
        return { value, heldMs: heldMs + now() - start, statements: asked.size };
      } catch (error) {
        const reason = replayReason(error);
        if (reason === null) throw error;
        if (reason instanceof NotReplayable) throw reason;
        stopped = reason;
      } finally {
        current = null;
        heldMs += now() - start;
      }
      if (stopped instanceof Miss) rows.set(stopped.key, await query(stopped.statement));
      else {
        const done = await mapInSteps(stopped.rows, stopped, now);
        heldMs += done.heldMs;
        mapped.set(stopped.key, { print: stopped.print, rows: done.rows });
      }
    }
    throw new NotReplayable(`a read didn't settle in ${MAX_PASSES} passes`);
  });

/**
 * Replays reads on [connection] (`replayRead`), and lets callers that ask for the same read
 * (the same function) at once share one replay. A caller joins a replay under way only until
 * that replay begins reading: its snapshot then starts after the caller asked, so it holds
 * every write the caller made before asking (writes run on the main connection, on the JS
 * thread, and finish before the call returns). Each caller gets its own copy of an array
 * result (the rows in it are shared, and no read's caller changes them); only the caller
 * whose replay ran is told the JS time it held.
 */
export const sharedReplays = (connection: ReadConnection, now: () => number) => {
  interface UnderWay {
    readonly replay: Promise<ReplayedRead<unknown>>;
    callers: number;
  }
  const joinable = new Map<object, UnderWay>();
  // Copies are taken as the replay settles, before any caller's code runs on the result.
  const own = <A>(entry: UnderWay, replayed: ReplayedRead<A>, ran: boolean): ReplayedRead<A> => {
    const value =
      entry.callers > 1 && Array.isArray(replayed.value)
        ? ([...replayed.value] as A)
        : replayed.value;
    return ran ? { ...replayed, value } : { value, heldMs: 0, statements: 0 };
  };
  return <A>(read: (db: LibraryDatabase) => A): Promise<ReplayedRead<A>> => {
    const running = joinable.get(read);
    if (running !== undefined) {
      running.callers++;
      return running.replay.then((replayed) => own(running, replayed as ReplayedRead<A>, false));
    }
    let entry: UnderWay | undefined;
    // From its first statement on, it takes no one else: the next ask replays the read again.
    const close = () => {
      if (entry !== undefined && joinable.get(read) === entry) joinable.delete(read);
    };
    const replay = replayRead(
      { snapshot: (inSnapshot) => connection.snapshot((query) => (close(), inSnapshot(query))) },
      read,
      now,
    );
    entry = { replay, callers: 1 };
    joinable.set(read, entry);
    replay.then(close, close);
    return replay.then((replayed) => own(entry!, replayed, true));
  };
};

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
