/**
 * A Wave sync service for tests, run by plain Node: one account's rows in
 * memory, merged by Core's rules as `apps/sync` merges them, numbered by
 * change and paged by pulls as the service pages them, with its body limit.
 * It answers what `WaveAccount.request` would.
 */
import {
  EMPTY_SYNC_TABLES,
  mergePlays,
  mergeRows,
  type SyncPlayRow,
  type SyncTables,
} from "@wave/core";

import type { SyncTransport } from "./syncCycle.ts";

type Table = keyof SyncTables;

const TABLES: readonly Table[] = [
  "songs",
  "playlists",
  "playlistEntries",
  "favorites",
  "preferences",
  "plays",
];

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
}

export const testSyncService = (options: { readonly pageSize?: number } = {}): TestSyncService => {
  const pageSize = options.pageSize ?? 1_000;
  const held = new Map<string, Held>();
  let changeSeq = 0;

  const rowsOf = (table: Table) =>
    [...held.values()].filter((entry) => entry.table === table).map((entry) => entry.row);

  const push = (body: Partial<SyncTables>) => {
    const accepted: Record<string, number> = {};
    for (const table of TABLES) {
      const incoming = body[table] ?? [];
      const current = rowsOf(table);
      const won =
        table === "plays"
          ? mergePlays(current as SyncPlayRow[], incoming as SyncPlayRow[]).added
          : mergeRows(
              current as SyncTables["songs"][number][],
              incoming as SyncTables["songs"][number][],
            ).accepted;
      for (const row of won) {
        held.set(`${table}:${row.id}`, { table, row, changeNo: ++changeSeq });
      }
      accepted[table] = won.length;
    }
    return { accepted };
  };

  const pull = (since: number) => {
    const changed = [...held.values()]
      .filter((entry) => entry.changeNo > since)
      // oxlint-disable-next-line unicorn/no-array-sort -- sorts a fresh array
      .sort((a, b) => a.changeNo - b.changeNo);
    const page = changed.slice(0, pageSize);
    const tables: Record<string, readonly unknown[]> = { ...EMPTY_SYNC_TABLES };
    for (const table of TABLES) {
      tables[table] = page
        .filter((entry) => entry.table === table)
        .map((entry) =>
          "deleted" in entry.row && entry.row.deleted
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
    requests: [],
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
        return { status: 200, body: JSON.stringify(push(JSON.parse(body))) };
      }
      const since = /^\/v1\/pull\?since=(\d+)$/.exec(path)?.[1];
      if (method === "GET" && since !== undefined) {
        return { status: 200, body: JSON.stringify(pull(Number(since))) };
      }
      return { status: 404, body: '{"error":"not_found"}' };
    },
  };
  return service;
};
