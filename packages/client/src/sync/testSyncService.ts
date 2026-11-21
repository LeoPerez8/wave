/**
 * A Wave sync service for tests, run by plain Node: one account's rows in
 * memory, merged by Core's rules as `apps/sync` merges them, numbered by
 * change and paged by pulls as the service pages them, with its body limit
 * and, when set, its retained-row limits. A change time ahead of its clock
 * is stored as its own time, and the push answer names those rows.
 * It answers what `WaveAccount.request` would.
 */
import {
  EMPTY_SYNC_TABLES,
  mergePlays,
  mergeTableRows,
  SYNC_TABLE_NAMES,
  withinServiceClock,
  type SyncPlayRow,
  type SyncTables,
} from "@wave/core";

import type { SyncTransport } from "./syncCycle.ts";

type Table = keyof SyncTables;

const TABLES: readonly Table[] = SYNC_TABLE_NAMES;

/** The service's limit on a request body (`SYNC_LIMITS.maxBodyBytes`). */
const MAX_BODY_BYTES = 2 * 1024 * 1024;

interface Held {
  readonly table: Table;
  readonly row: SyncTables[Table][number];
  readonly changeNo: number;
}

export interface TestSyncService extends SyncTransport {
  /** The rows the account holds, by table (the winning change of each). */
  readonly rows: () => SyncTables;
  /** Every request made, as `METHOD path`. */
  readonly requests: string[];
  /** While true, every request fails as it would offline. */
  offline: boolean;
  /** How many of the next requests are refused for the request rate (429). */
  refuse: number;
  /**
   * The most rows, deletions included, a table may hold: a push that would
   * add an id past it is refused whole (413), as the service refuses it.
   */
  rowLimits: Partial<Record<Table, number>>;
  /** Stores a push of [body] as `POST /v1/push` does: the answer, or the limit it passed. */
  readonly pushTables: (
    body: Partial<SyncTables>,
  ) =>
    | { readonly accepted: Record<string, number>; readonly corrected: Record<string, unknown> }
    | { readonly limit: string };
  /** A pull page after change [since] of the rows [keep] takes (all when absent). */
  readonly pullTables: (
    since: number,
    keep?: (table: Table, row: SyncTables[Table][number]) => boolean,
  ) => Record<string, unknown>;
}

/** The service's name for each table's row limit (`SYNC_LIMITS`). */
const LIMIT_NAMES: Record<Table, string> = {
  songs: "maxSongs",
  playlists: "maxPlaylists",
  playlistEntries: "maxPlaylistEntries",
  favorites: "maxFavorites",
  preferences: "maxPreferences",
  plays: "maxPlays",
  follows: "maxFollows",
  hiddenReleases: "maxHiddenReleases",
  notifiedShows: "maxNotifiedShows",
  dismissedSuggestions: "maxDismissedSuggestions",
  dislikes: "maxDislikes",
};

export const testSyncService = (
  options: {
    readonly pageSize?: number;
    /** The service's clock (the real time when absent, which no test phone's clock is ahead of). */
    readonly now?: () => number;
    /** Keys every `GET /v1/pull` answer carries besides the rows (the account's membership). */
    readonly pullExtras?: () => Record<string, unknown>;
  } = {},
): TestSyncService => {
  const pageSize = options.pageSize ?? 1_000;
  const now = options.now ?? Date.now;
  const held = new Map<string, Held>();
  let changeSeq = 0;

  const rowsOf = (table: Table) =>
    [...held.values()].filter((entry) => entry.table === table).map((entry) => entry.row);

  const push = (body: Partial<SyncTables>) => {
    const accepted: Record<string, number> = {};
    const corrected: Record<string, { id: string; changedAt: number }[]> = {};
    const won = new Map<Table, readonly SyncTables[Table][number][]>();
    for (const table of TABLES) {
      const pushed = body[table] ?? [];
      const current = rowsOf(table);
      const incoming =
        table === "plays"
          ? pushed
          : withinServiceClock(pushed as SyncTables["songs"][number][], now());
      const merged =
        table === "plays"
          ? mergePlays(current as SyncPlayRow[], incoming as SyncPlayRow[]).added
          : mergeTableRows(
              table,
              current as SyncTables["songs"][number][],
              incoming as SyncTables["songs"][number][],
            ).accepted;
      const stored = merged.filter(
        (row) => "changedAt" in row && !(pushed as readonly unknown[]).includes(row),
      );
      if (stored.length > 0) {
        corrected[table] = stored.map((row) => ({
          id: row.id,
          changedAt: (row as { changedAt: number }).changedAt,
        }));
      }
      const ids = new Set(current.map((row) => row.id));
      const limit = service.rowLimits[table];
      const added = new Set(merged.map((row) => row.id).filter((id) => !ids.has(id))).size;
      if (limit !== undefined && added > 0 && ids.size + added > limit) {
        return { limit: LIMIT_NAMES[table] };
      }
      won.set(table, merged);
    }
    for (const [table, rows] of won) {
      for (const row of rows) {
        held.set(`${table}:${row.id}`, { table, row, changeNo: ++changeSeq });
      }
      accepted[table] = rows.length;
    }
    return { accepted, corrected };
  };

  const pull = (
    since: number,
    keep: (table: Table, row: SyncTables[Table][number]) => boolean = () => true,
  ) => {
    const changed = [...held.values()]
      .filter((entry) => entry.changeNo > since && keep(entry.table, entry.row))
      // oxlint-disable-next-line unicorn/no-array-sort -- sorts a fresh array
      .sort((a, b) => a.changeNo - b.changeNo);
    const page = changed.slice(0, pageSize);
    const tables: Record<string, readonly unknown[]> = { ...EMPTY_SYNC_TABLES };
    for (const table of TABLES) {
      tables[table] = page
        .filter((entry) => entry.table === table)
        .map((entry) =>
          // As the service: a tombstone carries no fields, a Graveyard one keeps them.
          "deleted" in entry.row &&
          entry.row.deleted &&
          !("removedAt" in entry.row && typeof entry.row.removedAt === "number")
            ? {
                id: entry.row.id,
                changedAt: entry.row.changedAt,
                phoneId: entry.row.phoneId,
                deleted: true,
              }
            : entry.row,
        );
    }
    return {
      ...tables,
      cursor: String(page.at(-1)?.changeNo ?? since),
      more: changed.length > pageSize,
    };
  };

  const service: TestSyncService = {
    offline: false,
    refuse: 0,
    rowLimits: {},
    requests: [],
    pushTables: push,
    pullTables: pull,
    rows: () =>
      Object.fromEntries(TABLES.map((table) => [table, rowsOf(table)])) as unknown as SyncTables,
    request: async (method, path, body) => {
      service.requests.push(`${method} ${path}`);
      if (service.offline) throw Object.assign(new Error("offline"), { code: "ERR_WAVE_OFFLINE" });
      if (service.refuse > 0) {
        service.refuse -= 1;
        return { status: 429, body: '{"error":"limit","limit":"maxRequestsPerMinute"}' };
      }
      if (method === "POST" && path === "/v1/push") {
        if (body === null) return { status: 400, body: '{"error":"bad_request"}' };
        if (new TextEncoder().encode(body).length > MAX_BODY_BYTES) {
          return { status: 413, body: '{"error":"limit","limit":"maxBodyBytes"}' };
        }
        const pushed = push(JSON.parse(body));
        if ("limit" in pushed) {
          return { status: 413, body: JSON.stringify({ error: "limit", limit: pushed.limit }) };
        }
        return { status: 200, body: JSON.stringify(pushed) };
      }
      const since = /^\/v1\/pull\?since=(\d+)$/.exec(path)?.[1];
      if (method === "GET" && since !== undefined) {
        return {
          status: 200,
          body: JSON.stringify({ ...pull(Number(since)), ...options.pullExtras?.() }),
        };
      }
      return { status: 404, body: '{"error":"not_found"}' };
    },
  };
  return service;
};
