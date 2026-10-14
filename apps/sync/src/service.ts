/**
 * The sync service's routes (docs/spec.md, "Wave account and sync"). The
 * Worker (`worker.ts`) builds it from its env; the tests build it over a
 * local libSQL database and a fake Google. The request and response shapes
 * are in `apps/sync/README.md`.
 *
 * No route logs a request, a session token or an ID token.
 */

import type { Client } from "@libsql/client";
import { type GoogleKeys, googleKeys, verifyGoogleIdToken } from "./google.ts";
import { type SyncLimitName, type SyncLimits, SYNC_LIMITS } from "./limits.ts";
import { type PushBatch, deleteAccount, pullRows, pushRows } from "./store.ts";
import { type IncomingRow, type SyncTable, InvalidRow, SYNC_TABLES, parseRow } from "./tables.ts";

export interface SyncServiceOptions {
  readonly db: Client;
  /** Wave's web OAuth client id: an ID token's audience must be it. */
  readonly googleClientId: string;
  /** Emails that may sign in, separated by commas; unset or empty lets anyone in. */
  readonly allowedEmails?: string;
  /** How Google's keys are fetched (the Worker's `fetch`). */
  readonly fetch?: typeof fetch;
  /** Google's keys, when kept across requests (the Worker keeps them per isolate). */
  readonly googleKeys?: GoogleKeys;
  readonly now?: () => number;
  readonly limits?: SyncLimits;
  /** How many rows a pull answers at most. */
  readonly pullPageSize?: number;
}

/** How many rows a pull answers at most, by default. */
export const PULL_PAGE_SIZE = 1_000;

export type SyncService = (request: Request) => Promise<Response>;

/** What a route gets. */
interface RouteContext {
  readonly request: Request;
  readonly url: URL;
}

/** The session a request was made with. */
interface Session {
  readonly accountId: string;
  readonly tokenHash: string;
}

/** A push body checked against the tables: `{ "<table>": [rows] }`, every table optional. */
const parsePush = (body: unknown): PushBatch => {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw failure(400, "bad_request");
  }
  const batch = new Map<SyncTable, readonly IncomingRow[]>();
  for (const [name, rows] of Object.entries(body)) {
    const table = SYNC_TABLES.find((candidate) => candidate.name === name);
    if (table === undefined || !Array.isArray(rows)) throw invalid(`${name} isn't a table`);
    try {
      batch.set(
        table,
        rows.map((row: unknown, i) => parseRow(table, row, `${name}[${i}]`)),
      );
    } catch (error) {
      if (error instanceof InvalidRow) throw invalid(error.message);
      throw error;
    }
  }
  return batch;
};

type Route = (context: RouteContext) => Promise<Response>;

/** An answer that ends the request early, thrown from deep inside a route. */
class Answer extends Error {
  readonly response: Response;
  constructor(response: Response) {
    super("answer");
    this.response = response;
  }
}

const json = (body: unknown, status = 200, headers?: HeadersInit): Response =>
  Response.json(body, { status, ...(headers === undefined ? {} : { headers }) });

const failure = (status: number, error: string): Answer => new Answer(json({ error }, status));

/** A 400 that says which part of the body is wrong (`songs[3].durationMs is missing`). */
const invalid = (detail: string): Answer => new Answer(json({ error: "bad_request", detail }, 400));

const overLimit = (limit: SyncLimitName, status = 413): Answer =>
  new Answer(json({ error: "limit", limit }, status));

const base64url = (bytes: Uint8Array): string =>
  btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");

const sha256Hex = async (text: string): Promise<string> => {
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)),
  );
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
};

const parseAllowlist = (value: string | undefined): ReadonlySet<string> | null => {
  const emails = (value ?? "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter((email) => email !== "");
  return emails.length === 0 ? null : new Set(emails);
};

export const createSyncService = (options: SyncServiceOptions): SyncService => {
  const { db } = options;
  const now = options.now ?? Date.now;
  const limits = options.limits ?? SYNC_LIMITS;
  const pullPageSize = options.pullPageSize ?? PULL_PAGE_SIZE;
  const keys = options.googleKeys ?? googleKeys(options.fetch ?? fetch, now);
  const allowlist = parseAllowlist(options.allowedEmails);

  /** The request's JSON body, refusing one past `maxBodyBytes`. */
  const readJson = async (request: Request): Promise<unknown> => {
    const declared = Number(request.headers.get("content-length") ?? "0");
    if (declared > limits.maxBodyBytes) throw overLimit("maxBodyBytes");
    const bytes = new Uint8Array(await request.arrayBuffer());
    if (bytes.byteLength > limits.maxBodyBytes) throw overLimit("maxBodyBytes");
    try {
      return JSON.parse(new TextDecoder().decode(bytes));
    } catch {
      throw failure(400, "bad_request");
    }
  };

  const createSession: Route = async ({ request }) => {
    const body = await readJson(request);
    const idToken =
      typeof body === "object" && body !== null && "idToken" in body ? body.idToken : undefined;
    if (typeof idToken !== "string") throw failure(400, "bad_request");
    const identity = await verifyGoogleIdToken(idToken, {
      clientId: options.googleClientId,
      keys,
      now,
    });
    if (identity === null) throw failure(401, "invalid_id_token");
    if (allowlist !== null && !allowlist.has(identity.email.toLowerCase())) {
      throw failure(403, "not_allowed");
    }
    const sessionToken = base64url(crypto.getRandomValues(new Uint8Array(32)));
    const at = now();
    await db.batch(
      [
        {
          sql: `INSERT INTO accounts (id, google_sub, email, created_at) VALUES (?, ?, ?, ?)
                ON CONFLICT (google_sub) DO UPDATE SET email = excluded.email`,
          args: [crypto.randomUUID(), identity.sub, identity.email, at],
        },
        {
          sql: `INSERT INTO sessions (token_hash, account_id, created_at)
                SELECT ?, id, ? FROM accounts WHERE google_sub = ?`,
          args: [await sha256Hex(sessionToken), at, identity.sub],
        },
      ],
      "write",
    );
    return json({ sessionToken, email: identity.email });
  };

  /**
   * The session a request's `Authorization: Bearer <token>` names, counting
   * the request against its rate. Refuses with 401 when there's none, and
   * with 429 past `maxRequestsPerMinute`.
   */
  const authenticate = async (request: Request): Promise<Session> => {
    const match = /^Bearer (\S+)$/.exec(request.headers.get("authorization") ?? "");
    if (match?.[1] === undefined) throw failure(401, "unauthorized");
    const tokenHash = await sha256Hex(match[1]);
    const at = now();
    const window = Math.floor(at / 60_000);
    const result = await db.execute({
      sql: `UPDATE sessions
            SET window_count = CASE WHEN window_start = ? THEN window_count + 1 ELSE 1 END,
                window_start = ?
            WHERE token_hash = ?
            RETURNING account_id, window_count`,
      args: [window, window, tokenHash],
    });
    const row = result.rows[0];
    if (row === undefined) throw failure(401, "unauthorized");
    if (Number(row.window_count) > limits.maxRequestsPerMinute) {
      const retryAfter = Math.ceil(((window + 1) * 60_000 - at) / 1000);
      throw new Answer(
        json({ error: "limit", limit: "maxRequestsPerMinute" }, 429, {
          "retry-after": String(retryAfter),
        }),
      );
    }
    return { accountId: String(row.account_id), tokenHash };
  };

  /** A route that needs a session. */
  const withSession =
    (route: (context: RouteContext, session: Session) => Promise<Response>): Route =>
    async (context) =>
      route(context, await authenticate(context.request));

  const endSession = withSession(async (_context, session) => {
    await db.execute({ sql: "DELETE FROM sessions WHERE token_hash = ?", args: [session.tokenHash] });
    return new Response(null, { status: 204 });
  });

  const pushChanges = withSession(async ({ request }, session) => {
    const result = await pushRows(db, session.accountId, parsePush(await readJson(request)), limits);
    if ("overLimit" in result) throw overLimit(result.overLimit);
    return json({ accepted: result.accepted });
  });

  const pullChanges = withSession(async ({ url }, session) => {
    const since = url.searchParams.get("since") ?? "0";
    if (!/^\d{1,15}$/.test(since)) throw failure(400, "bad_request");
    const page = await pullRows(db, session.accountId, Number(since), pullPageSize);
    return json({ ...page.rows, cursor: String(page.cursor), more: page.more });
  });

  const removeAccount = withSession(async (_context, session) => {
    await deleteAccount(db, session.accountId);
    return new Response(null, { status: 204 });
  });

  /** Each route by method and path. */
  const routes: Readonly<Record<string, Route>> = {
    "POST /v1/session": createSession,
    "DELETE /v1/session": endSession,
    "POST /v1/push": pushChanges,
    "GET /v1/pull": pullChanges,
    "DELETE /v1/account": removeAccount,
  };

  return async (request) => {
    const url = new URL(request.url);
    const route = routes[`${request.method} ${url.pathname}`];
    if (route === undefined) return json({ error: "not_found" }, 404);
    try {
      return await route({ request, url });
    } catch (error) {
      if (error instanceof Answer) return error.response;
      // The message only: a request, and so a token, never reaches the log.
      console.error("sync service error:", error instanceof Error ? error.message : "unknown");
      return json({ error: "internal" }, 500);
    }
  };
};
