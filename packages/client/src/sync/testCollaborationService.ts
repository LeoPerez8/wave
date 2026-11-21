/**
 * Several Wave accounts on one sync service for tests, run by plain Node: each account's rows
 * in a `testSyncService`, and the collaborative playlists between them as `apps/sync` keeps
 * them (`apps/sync/README.md`, Collaborative playlists). A playlist's rows stay in its owner's
 * account; a member's push and pull of it (`/v1/collaboration/push` and `/pull`) write and read
 * the owner's rows after checking membership, and every account pull states the account's
 * collaborations and the ones it is no longer in. Each account's transport answers what
 * `WaveAccount.request` would, the collaboration routes the sync cycle sends included.
 */
import type { SyncTables } from "@wave/core";

import type { CollaborationTransport } from "./collaborationService.ts";
import { testSyncService, type TestSyncService } from "./testSyncService.ts";

interface Membership {
  readonly accountId: string;
  readonly joinedAt: number;
}

interface CollaborationRecord {
  owner: string;
  members: Membership[];
}

export interface TestAccount extends CollaborationTransport {
  readonly id: string;
  /** The account's own rows. */
  readonly service: TestSyncService;
  /** Every request made, as `METHOD path`. */
  readonly requests: string[];
  /** While true, every collaboration request fails as it would offline. */
  offline: boolean;
}

export interface TestCollaborationWorld {
  /** The account [id] (made on first use), named [id] for the others. */
  readonly account: (id: string) => TestAccount;
  /** [owner] makes its playlist [playlistId] collaborative. */
  readonly make: (owner: string, playlistId: string) => void;
  /** [accountId] joins [playlistId] (as an invite link would let it). */
  readonly join: (accountId: string, playlistId: string) => void;
  /** The owner removes [accountId]. */
  readonly remove: (playlistId: string, accountId: string) => void;
  /** The owner ends the collaboration. */
  readonly end: (playlistId: string) => void;
  /** [accountId] leaves. */
  readonly leave: (accountId: string, playlistId: string) => void;
  /** The playlist passes to [heir], its rows moving to the heir's account, numbered anew. */
  readonly passTo: (playlistId: string, heir: string) => void;
}

const TABLES = ["playlists", "playlistEntries"] as const;

export const testCollaborationWorld = (
  options: {
    /** How many rows each pull page holds, for every account (`testSyncService`). */
    readonly pageSize?: number;
  } = {},
): TestCollaborationWorld => {
  const accounts = new Map<string, TestAccount>();
  const collaborations = new Map<string, CollaborationRecord>();
  /** `account:playlist` → why it ended. */
  const ends = new Map<string, { reason: "left" | "ended"; endedAt: number }>();
  /** Which playlist each entry id is in, as the service keeps it on a tombstone. */
  const entryPlaylist = new Map<string, string>();
  let clock = 1;

  const noteEntries = (body: Partial<SyncTables>): void => {
    for (const row of body.playlistEntries ?? []) {
      if ("playlistId" in row && typeof row.playlistId === "string")
        entryPlaylist.set(row.id, row.playlistId);
    }
  };

  const membersOf = (accountId: string, playlistId: string) => {
    const record = collaborations.get(playlistId);
    if (record === undefined) return null;
    return {
      playlistId,
      members: record.members.map((each) => ({
        accountId: each.accountId,
        name: each.accountId,
        joinedAt: each.joinedAt,
        owner: each.accountId === record.owner,
        self: each.accountId === accountId,
      })),
    };
  };

  const isMember = (accountId: string, playlistId: string): boolean =>
    collaborations.get(playlistId)?.members.some((each) => each.accountId === accountId) === true;

  const ofPlaylist =
    (playlistId: string) =>
    (table: keyof SyncTables, row: SyncTables[keyof SyncTables][number]): boolean => {
      if (table === "playlists") return row.id === playlistId;
      if (table !== "playlistEntries") return false;
      const of = "playlistId" in row ? row.playlistId : entryPlaylist.get(row.id);
      return of === playlistId;
    };

  /**
   * [pushed] with each entry of a collaborative playlist carrying the account that added it,
   * as the service writes it from the session: the first push of an entry, kept after.
   */
  const withAdders = (
    pushed: Partial<SyncTables>,
    accountId: string,
    held: TestSyncService,
  ): Partial<SyncTables> => {
    const entries = pushed.playlistEntries;
    if (entries === undefined) return pushed;
    const stored = new Map(held.rows().playlistEntries.map((row) => [row.id, row]));
    return {
      ...pushed,
      playlistEntries: entries.map((row) => {
        const of = "playlistId" in row ? row.playlistId : entryPlaylist.get(row.id);
        if (typeof of !== "string" || !collaborations.has(of)) return row;
        const before = stored.get(row.id);
        const addedBy =
          before !== undefined && "addedBy" in before && typeof before.addedBy === "string"
            ? before.addedBy
            : accountId;
        return { ...row, addedBy };
      }),
    };
  };

  const json = (status: number, body: unknown) => ({ status, body: JSON.stringify(body) });

  const leaveAs = (accountId: string, playlistId: string): void => {
    const record = collaborations.get(playlistId);
    if (record === undefined) return;
    record.members = record.members.filter((each) => each.accountId !== accountId);
    ends.set(`${accountId}:${playlistId}`, { reason: "left", endedAt: clock++ });
  };

  const account = (id: string): TestAccount => {
    const held = accounts.get(id);
    if (held !== undefined) return held;
    const service = testSyncService({
      ...(options.pageSize === undefined ? {} : { pageSize: options.pageSize }),
      pullExtras: () => ({
        collaborations: [...collaborations.keys()]
          .filter((playlistId) => isMember(id, playlistId))
          .map((playlistId) => membersOf(id, playlistId)),
        endedCollaborations: [...ends]
          .filter(([key]) => key.startsWith(`${id}:`))
          .map(([key, end]) => ({ playlistId: key.slice(id.length + 1), ...end })),
      }),
    });
    const made: TestAccount = {
      id,
      service,
      requests: [],
      offline: false,
      request: async (method, path, body) => {
        made.requests.push(`${method} ${path}`);
        const url = new URL(path, "https://sync.test");
        const playlistId = url.searchParams.get("playlist") ?? "";
        if (url.pathname.startsWith("/v1/collaboration")) {
          if (made.offline) throw Object.assign(new Error("offline"), { code: "ERR_WAVE_OFFLINE" });
          if (!isMember(id, playlistId)) return json(403, { error: "not_member" });
          if (method === "GET" && url.pathname === "/v1/collaboration/members") {
            return json(200, membersOf(id, playlistId));
          }
          if (method === "DELETE" && url.pathname === "/v1/collaboration/membership") {
            leaveAs(id, playlistId);
            return { status: 204, body: "" };
          }
          const owner = account(collaborations.get(playlistId)?.owner ?? "");
          if (method === "GET" && url.pathname === "/v1/collaboration/pull") {
            const since = Number(url.searchParams.get("since") ?? "0");
            return json(200, owner.service.pullTables(since, ofPlaylist(playlistId)));
          }
          if (method === "POST" && url.pathname === "/v1/collaboration/push") {
            const pushed = JSON.parse(body ?? "{}") as Partial<SyncTables>;
            const keep = ofPlaylist(playlistId);
            const rows = TABLES.flatMap((table) =>
              (pushed[table] ?? []).map((row) => [table, row] as const),
            );
            for (const [table, row] of rows) {
              if (table === "playlists" && row.deleted) return json(403, { error: "not_owner" });
              if (!keep(table, row) && !(table === "playlistEntries" && row.deleted))
                return json(400, { error: "bad_request" });
            }
            const playlist = owner.service.rows().playlists.find((row) => row.id === playlistId);
            if (playlist?.deleted === true) return json(403, { error: "deleted" });
            noteEntries(pushed);
            const stored = owner.service.pushTables(withAdders(pushed, id, owner.service));
            if ("limit" in stored) return json(413, { error: "limit", limit: stored.limit });
            return json(200, stored);
          }
          return json(404, { error: "not_found" });
        }
        if (method === "POST" && path === "/v1/push" && body !== null) {
          const pushed = JSON.parse(body) as Partial<SyncTables>;
          noteEntries(pushed);
          const stamped = JSON.stringify(withAdders(pushed, id, service));
          return service.request("POST", path, stamped);
        }
        return service.request(method as "GET" | "POST", path, body);
      },
    };
    accounts.set(id, made);
    return made;
  };

  const endFor = (accountId: string, playlistId: string, reason: "left" | "ended"): void => {
    ends.set(`${accountId}:${playlistId}`, { reason, endedAt: clock++ });
  };

  return {
    account,
    make: (owner, playlistId) => {
      collaborations.set(playlistId, {
        owner,
        members: [{ accountId: owner, joinedAt: clock++ }],
      });
    },
    join: (accountId, playlistId) => {
      const record = collaborations.get(playlistId);
      if (record === undefined) throw new Error(`${playlistId} isn't collaborative`);
      record.members.push({ accountId, joinedAt: clock++ });
      ends.delete(`${accountId}:${playlistId}`);
    },
    remove: (playlistId, accountId) => {
      const record = collaborations.get(playlistId);
      if (record === undefined) return;
      record.members = record.members.filter((each) => each.accountId !== accountId);
      endFor(accountId, playlistId, "ended");
    },
    end: (playlistId) => {
      const record = collaborations.get(playlistId);
      if (record === undefined) return;
      collaborations.delete(playlistId);
      for (const each of record.members) {
        if (each.accountId !== record.owner) endFor(each.accountId, playlistId, "ended");
      }
    },
    leave: leaveAs,
    passTo: (playlistId, heir) => {
      const record = collaborations.get(playlistId);
      if (record === undefined) return;
      const from = account(record.owner).service;
      const rows = from.rows();
      account(heir).service.pushTables({
        playlists: rows.playlists.filter((row) => row.id === playlistId),
        playlistEntries: rows.playlistEntries.filter((row) =>
          ofPlaylist(playlistId)("playlistEntries", row),
        ),
      });
      record.members = record.members.filter((each) => each.accountId !== record.owner);
      record.owner = heir;
    },
  };
};
