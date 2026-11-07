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
import {
  type SoulseekKeys,
  importSoulseekKeys,
  keepSoulseekAccount,
  parseSoulseekAccount,
  readSoulseekAccount,
} from "./soulseek.ts";
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
  /**
   * The Soulseek keys by secret name (`SOULSEEK_KEY`, `SOULSEEK_KEY_2`, …),
   * each base64 of a 32-byte AES-GCM key; the highest version is current
   * (src/soulseek.ts). Without any, the Soulseek routes answer 500 and the
   * rest work.
   */
  readonly soulseekKeys?: Readonly<Record<string, string>>;
}

/** How long ago Google may have issued the ID token that confirms deleting an account. */
const REAUTHENTICATION_MAX_AGE_MS = 5 * 60_000;

/** How many rows a pull answers at most, by default. */
const PULL_PAGE_SIZE = 1_000;

/** How long a session lasts unused: any authenticated request starts it again. */
const SESSION_UNUSED_MS = 90 * 24 * 60 * 60 * 1000;

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

/** A 429 past a per-minute rate at [at], whose `Retry-After` is the seconds left in that minute. */
const tooMany = (limit: SyncLimitName, at: number): Answer =>
  new Answer(
    json({ error: "limit", limit }, 429, {
      "retry-after": String(Math.ceil((60_000 - (at % 60_000)) / 1000)),
    }),
  );

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

  /**
   * Counts a sign-in against [key]'s minute (`sign_in_windows`), refusing with
   * 429 past `maxSignInsPerMinute`. Rows of past minutes go as it counts.
   */
  const countSignIn = async (key: string): Promise<void> => {
    const at = now();
    const window = Math.floor(at / 60_000);
    const [, counted] = await db.batch(
      [
        { sql: "DELETE FROM sign_in_windows WHERE window_start <> ?", args: [window] },
        {
          sql: `INSERT INTO sign_in_windows (key, window_start, window_count) VALUES (?, ?, 1)
                ON CONFLICT (key) DO UPDATE SET window_count = window_count + 1
                RETURNING window_count`,
          args: [key, window],
        },
      ],
      "write",
    );
    if (Number(counted?.rows[0]?.window_count) > limits.maxSignInsPerMinute) {
      throw tooMany("maxSignInsPerMinute", at);
    }
  };

  const createSession: Route = async ({ request }) => {
    // Counted before the ID token is checked, so failing ones count too.
    const address = request.headers.get("cf-connecting-ip");
    if (address !== null) await countSignIn(`ip:${await sha256Hex(address)}`);
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
    await countSignIn(`sub:${identity.sub}`);
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
          sql: `INSERT INTO sessions (token_hash, account_id, created_at, last_used_at)
                SELECT ?, id, ?, ? FROM accounts WHERE google_sub = ?`,
          args: [await sha256Hex(sessionToken), at, at, identity.sub],
        },
      ],
      "write",
    );
    return json({ sessionToken, email: identity.email });
  };

  /**
   * The session a request's `Authorization: Bearer <token>` names, counting
   * the request against its rate and marking it used. Refuses with 401 when
   * there's none or it went unused for `SESSION_UNUSED_MS` (and deletes it),
   * and with 429 past `maxRequestsPerMinute`.
   */
  const authenticate = async (request: Request): Promise<Session> => {
    const match = /^Bearer (\S+)$/.exec(request.headers.get("authorization") ?? "");
    if (match?.[1] === undefined) throw failure(401, "unauthorized");
    const tokenHash = await sha256Hex(match[1]);
    const at = now();
    const window = Math.floor(at / 60_000);
    const unusedSince = at - SESSION_UNUSED_MS;
    // One query for a live session. An expired one keeps its last use, so the
    // answer tells it apart, and is deleted below.
    const result = await db.execute({
      sql: `UPDATE sessions
            SET window_count = CASE WHEN window_start = ? THEN window_count + 1 ELSE 1 END,
                window_start = ?,
                last_used_at = CASE WHEN last_used_at > ? THEN ? ELSE last_used_at END
            WHERE token_hash = ?
            RETURNING account_id, window_count, last_used_at`,
      args: [window, window, unusedSince, at, tokenHash],
    });
    const row = result.rows[0];
    if (row === undefined) throw failure(401, "unauthorized");
    if (Number(row.last_used_at) <= unusedSince) {
      await db.execute({ sql: "DELETE FROM sessions WHERE token_hash = ?", args: [tokenHash] });
      throw failure(401, "unauthorized");
    }
    if (Number(row.window_count) > limits.maxRequestsPerMinute) {
      throw tooMany("maxRequestsPerMinute", at);
    }
    return { accountId: String(row.account_id), tokenHash };
  };

  /** A route that needs a session. */
  const withSession =
    (route: (context: RouteContext, session: Session) => Promise<Response>): Route =>
    async (context) =>
      route(context, await authenticate(context.request));

  const endSession = withSession(async (_context, session) => {
    await db.execute({
      sql: "DELETE FROM sessions WHERE token_hash = ?",
      args: [session.tokenHash],
    });
    return new Response(null, { status: 204 });
  });

  /** Sign out everywhere: every session of the account ends, this one too. */
  const endAllSessions = withSession(async (_context, session) => {
    await db.execute({
      sql: "DELETE FROM sessions WHERE account_id = ?",
      args: [session.accountId],
    });
    return new Response(null, { status: 204 });
  });

  const pushChanges = withSession(async ({ request }, session) => {
    const result = await pushRows(
      db,
      session.accountId,
      parsePush(await readJson(request)),
      limits,
    );
    if ("overLimit" in result) throw overLimit(result.overLimit);
    return json({ accepted: result.accepted });
  });

  const pullChanges = withSession(async ({ url }, session) => {
    const since = url.searchParams.get("since") ?? "0";
    if (!/^\d{1,15}$/.test(since)) throw failure(400, "bad_request");
    const page = await pullRows(db, session.accountId, Number(since), pullPageSize);
    return json({ ...page.rows, cursor: String(page.cursor), more: page.more });
  });

  /**
   * Deleting the account needs, besides the session, a Google ID token issued
   * in the last 5 minutes for the account's own Google subject.
   */
  const removeAccount = withSession(async ({ request }, session) => {
    let body: unknown = null;
    try {
      body = await readJson(request);
    } catch (error) {
      if (!(error instanceof Answer) || error.response.status !== 400) throw error;
    }
    const idToken =
      typeof body === "object" && body !== null && "idToken" in body ? body.idToken : undefined;
    if (typeof idToken !== "string") throw failure(401, "id_token_required");
    const identity = await verifyGoogleIdToken(idToken, {
      clientId: options.googleClientId,
      keys,
      now,
    });
    const account = await db.execute({
      sql: "SELECT google_sub FROM accounts WHERE id = ?",
      args: [session.accountId],
    });
    if (
      identity === null ||
      identity.issuedAt === null ||
      now() - identity.issuedAt > REAUTHENTICATION_MAX_AGE_MS ||
      identity.sub !== account.rows[0]?.google_sub
    ) {
      throw failure(401, "invalid_id_token");
    }
    await deleteAccount(db, session.accountId);
    return new Response(null, { status: 204 });
  });

  // Imported at the first Soulseek request, and again after a failed import.
  let soulseekKeys: Promise<SoulseekKeys> | null = null;
  const soulseekCipherKeys = (): Promise<SoulseekKeys> => {
    soulseekKeys ??= importSoulseekKeys(options.soulseekKeys).catch((error: unknown) => {
      soulseekKeys = null;
      throw error;
    });
    return soulseekKeys;
  };

  const putSoulseek = withSession(async ({ request }, session) => {
    const account = parseSoulseekAccount(await readJson(request));
    if (account === null) throw invalid("a Soulseek username and password are needed");
    await keepSoulseekAccount(db, await soulseekCipherKeys(), session.accountId, account, now());
    return new Response(null, { status: 204 });
  });

  const getSoulseek = withSession(async (_context, session) =>
    json({ account: await readSoulseekAccount(db, await soulseekCipherKeys(), session.accountId) }),
  );

  /** Each route by method and path. */
  const routes: Readonly<Record<string, Route>> = {
    "POST /v1/session": createSession,
    "DELETE /v1/session": endSession,
    "DELETE /v1/sessions": endAllSessions,
    "POST /v1/push": pushChanges,
    "GET /v1/pull": pullChanges,
    "DELETE /v1/account": removeAccount,
    "PUT /v1/soulseek": putSoulseek,
    "GET /v1/soulseek": getSoulseek,
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
