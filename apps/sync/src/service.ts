/**
 * The sync service's routes (docs/spec.md, "Wave account and sync"). The
 * Worker (`worker.ts`) builds it from its env; the tests build it over a
 * local libSQL database and a fake Google. The request and response shapes
 * are in `apps/sync/README.md`.
 *
 * No route logs a request, a session token or an ID token.
 */

import type { Client } from "@libsql/client";
import {
  acceptedLanguages,
  accountName,
  catalogueOf,
  geniusUpstreamUrl,
  resolveAppLanguage,
  sha256Hex,
  ticketmasterUpstreamUrl,
} from "@wave/core";
import {
  type CollaborationRefusal,
  collaborationMembers,
  endCollaboration,
  leaveCollaboration,
  makeCollaboration,
  removeMember,
} from "./collaborations.ts";
import { type GoogleKeys, googleKeys, verifyGoogleIdToken } from "./google.ts";
import {
  type InviteOwnerRefusal,
  createInvite,
  currentInvite,
  joinInvite,
  readInvite,
  turnOffInvite,
} from "./invites.ts";
import { type SyncLimitName, type SyncLimits, SYNC_LIMITS } from "./limits.ts";
import {
  type SoulseekKeys,
  importSoulseekKeys,
  keepSoulseekAccount,
  parseSoulseekAccount,
  readSoulseekAccount,
} from "./soulseek.ts";
import {
  type Upstream,
  type UpstreamRequest,
  askUpstream,
  cachedAnswer,
  keepAnswer,
  proxiedAnswer,
} from "./proxy.ts";
import { SESSION_UNUSED_MS } from "./sessions.ts";
import {
  type PushBatch,
  deleteAccount,
  pullPlaylistRows,
  pullRows,
  pushPlaylistRows,
  pushRows,
} from "./store.ts";
import { type IncomingRow, type SyncTable, InvalidRow, SYNC_TABLES, parseRow } from "./tables.ts";

/**
 * Counts a call against a key and says whether it's within the limit: the
 * Worker's rate limiting binding, or a stand-in in the tests.
 */
export interface RateLimiter {
  readonly limit: (options: { readonly key: string }) => Promise<{ readonly success: boolean }>;
}

/** A provider the service asks for phones: the Worker's key for it and its per-account limiter. */
export interface ProviderAccess {
  readonly token: string;
  /** Counts each account's requests to the provider's routes per minute. */
  readonly limiter: RateLimiter;
}

export interface SyncServiceOptions {
  readonly db: Client;
  /** Counts every request by address (`maxRequestsPerAddressPerMinute`). */
  readonly addressLimiter: RateLimiter;
  /** Counts failed session lookups by address (`maxFailedLookupsPerAddressPerMinute`). */
  readonly failedLookupLimiter: RateLimiter;
  /** Wave's web OAuth client id, used by the phone. */
  readonly googleClientId: string;
  /** Optional Desktop OAuth client id, configured on the Worker. */
  readonly googleDesktopClientId?: string;
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
  /** Where the counts of refused requests go (`console.warn` by default). */
  readonly log?: (message: string) => void;
  /** What's kept across requests (the Worker keeps it per isolate); a fresh one by default. */
  readonly memory?: ServiceMemory;
  /** How the provider routes reach providers and the cache; the Worker's `fetch` with no cache by default. */
  readonly upstream?: Upstream;
  /** Genius (`GENIUS_ACCESS_TOKEN`, `maxGeniusRequestsPerMinute`); without it the Genius routes answer 503. */
  readonly genius?: ProviderAccess;
  /**
   * Ticketmaster (`TICKETMASTER_API_KEY`, `maxTicketmasterRequestsPerMinute`);
   * without it the Ticketmaster routes answer 503.
   */
  readonly ticketmaster?: ProviderAccess;
  /** Waits [ms] for a provider's turn (`setTimeout` by default). */
  readonly wait?: (ms: number) => Promise<void>;
}

/**
 * What the service keeps between requests: the addresses held back after
 * failed session lookups, the refusals not yet logged, and when each paced
 * provider may next be asked.
 */
export interface ServiceMemory {
  /** By address key, when it may look up sessions again. */
  readonly heldAddresses: Map<string, number>;
  readonly refusals: Map<Refusal, number>;
  loggedAt: number;
  /** By provider name, the earliest moment its next request may start. */
  readonly upstreamTurns: Map<string, number>;
}

export const serviceMemory = (): ServiceMemory => ({
  heldAddresses: new Map(),
  refusals: new Map(),
  loggedAt: -Infinity,
  upstreamTurns: new Map(),
});

/** How long ago Google may have issued the ID token that confirms deleting an account. */
const REAUTHENTICATION_MAX_AGE_MS = 5 * 60_000;

/** The window `maxNewAccountsPerDay` counts in. */
const DAY_MS = 86_400_000;

/** How many rows a pull answers at most, by default. */
const PULL_PAGE_SIZE = 1_000;

/** How long a Genius answer is kept for other phones. */
const GENIUS_TTL_SECONDS = 24 * 60 * 60;

/**
 * How long a Ticketmaster answer is kept for other phones: Home's show check
 * runs every 12 hours, and Ticketmaster's terms want event content gone
 * within 24 hours of a removal.
 */
const TICKETMASTER_TTL_SECONDS = 12 * 60 * 60;

/**
 * How far apart Ticketmaster's requests start, from one isolate: its key
 * takes about 5 a second, from every phone together.
 */
const TICKETMASTER_SPACING_MS = 250;

/** How long a request may wait for its turn with a paced provider before it answers 503 `busy`. */
const MAX_TURN_WAIT_MS = 5_000;

export type SyncService = (request: Request) => Promise<Response>;

/** What a route gets. */
interface RouteContext {
  readonly request: Request;
  readonly url: URL;
  /** A SHA-256 of the address the request came from, when Cloudflare names it. */
  readonly addressKey: string | null;
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

/** Why a request was refused before reaching a route, in the order the log lists them. */
const REFUSALS = [
  "malformed_token",
  "unknown_session",
  "unknown_invite",
  "held_address",
  "address_limit",
] as const;

type Refusal = (typeof REFUSALS)[number];

/** What `POST /v1/session` gives: base64url of 32 random bytes. */
const SESSION_TOKEN = /^[A-Za-z0-9_-]{43}$/;

/**
 * The SHA-256 of the certificate of Wave's release key, which signs every APK phones install
 * (docs/spec.md, APK signing; pinned in scripts/ci/sign-apk.sh).
 */
const RELEASE_CERTIFICATE_SHA256 =
  "80cee0c33afc558f4b130433c78035bba0f966f1c8f0fce422f587e245fcde65";
/**
 * The SHA-256 of Expo's public debug key, the first signer in the release APK's rotation proof
 * (pinned in scripts/ci/sign-apk.sh).
 */
const PREVIOUS_RELEASE_CERTIFICATE_SHA256 =
  "fac61745dc0903786fb9ede62a962b399f7348f0bb6f899b8332667591033b9c";

/**
 * `GET /.well-known/assetlinks.json`: Android's App Link check, so an invite link opens Wave
 * (the `/invite` filter in apps/mobile/app.config.ts) with nothing to turn on in Open by default.
 * Android's verifier checks a rotated APK by the first certificate of its rotation proof, the
 * debug key's, so the file names it beside the release key's (#1417); with the release key's
 * alone the host stays unverified.
 */
const assetLinks = (): Response =>
  new Response(
    JSON.stringify([
      {
        relation: ["delegate_permission/common.handle_all_urls"],
        target: {
          namespace: "android_app",
          package_name: "dev.leoperez.wave",
          sha256_cert_fingerprints: [
            RELEASE_CERTIFICATE_SHA256,
            PREVIOUS_RELEASE_CERTIFICATE_SHA256,
          ].map((fingerprint) => fingerprint.toUpperCase().replaceAll(/(..)(?!$)/g, "$1:")),
        },
      },
    ]),
    {
      headers: { "content-type": "application/json", "cache-control": "public, max-age=3600" },
    },
  );

/** The page an invite link opens in a browser: nothing of the playlist, and no script. */
const invitePage = (acceptLanguage: string | null): Response => {
  const language = resolveAppLanguage(acceptedLanguages(acceptLanguage));
  const text = catalogueOf(language).invitePage;
  const escape = (value: string): string =>
    value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  const html = `<!doctype html>
<html lang="${language}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${escape(text.title)}</title>
<style>
body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;
font-family:system-ui,sans-serif;background:#fff;color:#1c1c1e;text-align:center;padding:0 16px}
@media (prefers-color-scheme:dark){body{background:#000;color:#f2f2f7}}
h1{font-size:1.5rem;margin:0 0 .5rem}p{margin:0;opacity:.7}
</style>
</head>
<body><main><h1>${escape(text.heading)}</h1><p>${escape(text.body)}</p></main></body>
</html>
`;
  return new Response(html, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "content-language": language,
      vary: "accept-language",
      "cache-control": "public, max-age=3600",
      "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'",
      "referrer-policy": "no-referrer",
      "x-robots-tag": "noindex",
      "x-content-type-options": "nosniff",
    },
  });
};

const base64url = (bytes: Uint8Array): string =>
  btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");

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
  const clientIds = [options.googleClientId, options.googleDesktopClientId]
    .map((id) => id?.trim())
    .filter((id): id is string => id !== undefined && id !== "");
  const allowlist = parseAllowlist(options.allowedEmails);
  const log = options.log ?? ((message: string) => console.warn(message));
  const memory = options.memory ?? serviceMemory();
  const { heldAddresses, refusals } = memory;

  /**
   * Counts a refusal, logging the counts when a minute has passed since the
   * last line, so a flood doesn't flood the log.
   */
  const refused = (refusal: Refusal): void => {
    refusals.set(refusal, (refusals.get(refusal) ?? 0) + 1);
    const at = now();
    if (at - memory.loggedAt < 60_000) return;
    memory.loggedAt = at;
    const counts = REFUSALS.filter((name) => refusals.has(name)).map(
      (name) => `${name}=${refusals.get(name)}`,
    );
    refusals.clear();
    log(`sync service refused requests: ${counts.join(", ")}`);
  };

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
   * 429 past `maxSignInsPerMinute`, or when [key] is new and the minute
   * already holds `maxSignInKeysPerMinute` keys. Rows of past minutes go as
   * it counts.
   */
  const countSignIn = async (key: string): Promise<void> => {
    const at = now();
    const window = Math.floor(at / 60_000);
    // One transaction: a key already counted always counts on, and a new one
    // is added only below the cap, so two sign-ins can't both take the last place.
    const [, counted] = await db.batch(
      [
        { sql: "DELETE FROM sign_in_windows WHERE window_start <> ?", args: [window] },
        {
          sql: `INSERT INTO sign_in_windows (key, window_start, window_count)
                SELECT ?, ?, 1
                WHERE EXISTS (SELECT 1 FROM sign_in_windows WHERE key = ?)
                   OR (SELECT count(*) FROM sign_in_windows) < ?
                ON CONFLICT (key) DO UPDATE SET window_count = window_count + 1
                RETURNING window_count`,
          args: [key, window, key, limits.maxSignInKeysPerMinute],
        },
      ],
      "write",
    );
    const count = counted?.rows[0]?.window_count;
    if (count === undefined) throw tooMany("maxSignInKeysPerMinute", at);
    if (Number(count) > limits.maxSignInsPerMinute) {
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
      clientIds,
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
    // One transaction: the account and session limits are checked where the
    // account and the session are made, so two sign-ins can't both take the
    // last place.
    const [, , , made, held] = await db.batch(
      [
        {
          sql: `DELETE FROM sessions
                WHERE last_used_at <= ?
                  AND account_id IN (SELECT id FROM accounts WHERE google_sub = ?)`,
          args: [at - SESSION_UNUSED_MS, identity.sub],
        },
        {
          // A token without a name leaves the name there is.
          sql: "UPDATE accounts SET email = ?, name = coalesce(?, name) WHERE google_sub = ?",
          args: [identity.email, identity.name, identity.sub],
        },
        {
          sql: `INSERT INTO accounts (id, google_sub, email, name, created_at)
                SELECT ?, ?, ?, ?, ?
                WHERE NOT EXISTS (SELECT 1 FROM accounts WHERE google_sub = ?)
                  AND (SELECT count(*) FROM accounts) < ?
                  AND (SELECT count(*) FROM accounts WHERE created_at > ?) < ?`,
          args: [
            crypto.randomUUID(),
            identity.sub,
            identity.email,
            identity.name,
            at,
            identity.sub,
            limits.maxAccounts,
            at - DAY_MS,
            limits.maxNewAccountsPerDay,
          ],
        },
        {
          sql: `INSERT INTO sessions (token_hash, account_id, created_at, last_used_at)
                SELECT ?, id, ?, ? FROM accounts
                WHERE google_sub = ?
                  AND (SELECT count(*) FROM sessions WHERE account_id = accounts.id) < ?`,
          args: [await sha256Hex(sessionToken), at, at, identity.sub, limits.maxSessionsPerAccount],
        },
        {
          sql: `SELECT EXISTS (SELECT 1 FROM accounts WHERE google_sub = ?) AS present,
                       (SELECT name FROM accounts WHERE google_sub = ?) AS name,
                       (SELECT count(*) FROM accounts) AS total,
                       (SELECT min(created_at) FROM accounts WHERE created_at > ?) AS oldest`,
          args: [identity.sub, identity.sub, at - DAY_MS],
        },
      ],
      "write",
    );
    const account = held?.rows[0];
    if (Number(account?.present) !== 1) {
      if (Number(account?.total) >= limits.maxAccounts) throw overLimit("maxAccounts", 403);
      // The day's places come back as the oldest of them turns a day old.
      const wait = Number(account?.oldest ?? at) + DAY_MS - at;
      throw new Answer(
        json({ error: "limit", limit: "maxNewAccountsPerDay" }, 429, {
          "retry-after": String(Math.max(1, Math.ceil(wait / 1000))),
        }),
      );
    }
    // The account's valid sessions stay as they are: none is ended to make room.
    if (made?.rowsAffected !== 1) throw overLimit("maxSessionsPerAccount", 403);
    const name = account?.name;
    return json({
      sessionToken,
      email: identity.email,
      name: typeof name === "string" ? name : null,
    });
  };

  /**
   * Refuses with 429 while [addressKey] is held back: past
   * `maxFailedLookupsPerAddressPerMinute`, checked with no query.
   */
  const refuseIfHeld = (addressKey: string): void => {
    const until = heldAddresses.get(addressKey);
    if (until === undefined) return;
    const at = now();
    if (at >= until) {
      heldAddresses.delete(addressKey);
      return;
    }
    refused("held_address");
    throw new Answer(
      json({ error: "limit", limit: "maxFailedLookupsPerAddressPerMinute" }, 429, {
        "retry-after": String(Math.ceil((until - at) / 1000)),
      }),
    );
  };

  /** Counts a lookup that found no session, holding [addressKey] back once past the limit. */
  const countFailedLookup = async (addressKey: string): Promise<void> => {
    if ((await options.failedLookupLimiter.limit({ key: addressKey })).success) return;
    const at = now();
    for (const [key, until] of heldAddresses) if (at >= until) heldAddresses.delete(key);
    heldAddresses.set(addressKey, at + limits.failedLookupBlockSeconds * 1000);
  };

  /**
   * The session a request's `Authorization: Bearer <token>` names, counting
   * the request against its rate and marking it used. Refuses with 401 when
   * there's none or it went unused for `SESSION_UNUSED_MS` (and deletes it),
   * and with 429 past `maxRequestsPerMinute`.
   */
  const authenticate = async ({ request, addressKey }: RouteContext): Promise<Session> => {
    const match = /^Bearer (\S+)$/.exec(request.headers.get("authorization") ?? "");
    if (match?.[1] === undefined || !SESSION_TOKEN.test(match[1])) {
      refused("malformed_token");
      throw failure(401, "unauthorized");
    }
    if (addressKey !== null) refuseIfHeld(addressKey);
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
    if (row === undefined) {
      refused("unknown_session");
      if (addressKey !== null) await countFailedLookup(addressKey);
      throw failure(401, "unauthorized");
    }
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
      route(context, await authenticate(context));

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
      now(),
    );
    if ("overLimit" in result) throw overLimit(result.overLimit);
    return json({ accepted: result.accepted, corrected: result.corrected });
  });

  const pullChanges = withSession(async ({ url }, session) => {
    const since = url.searchParams.get("since") ?? "0";
    if (!/^\d{1,15}$/.test(since)) throw failure(400, "bad_request");
    const page = await pullRows(db, session.accountId, Number(since), pullPageSize);
    return json({
      ...page.rows,
      cursor: String(page.cursor),
      more: page.more,
      collaborations: page.collaborations,
      endedCollaborations: page.endedCollaborations,
    });
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
      clientIds,
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

  /**
   * Keeps the body's name for the session's account, as a sign-in keeps the
   * ID token's: an app that signed in before names were kept sends it once.
   */
  const putAccountName = withSession(async ({ request }, session) => {
    const body = await readJson(request);
    const name = accountName(
      typeof body === "object" && body !== null && "name" in body ? body.name : undefined,
    );
    if (name === null) throw failure(400, "bad_request");
    await db.execute({
      sql: "UPDATE accounts SET name = ? WHERE id = ?",
      args: [name, session.accountId],
    });
    return new Response(null, { status: 204 });
  });

  /** The query's `playlist`: the id of the playlist a collaboration route is about. */
  const playlistAsked = (url: URL): string => {
    const playlistId = url.searchParams.get("playlist");
    if (playlistId === null || playlistId === "") throw failure(400, "bad_request");
    return playlistId;
  };

  /** A 204, or what a refusal answers: 403, and 404 for an account to remove that isn't in the playlist. */
  const settled = (refusal: CollaborationRefusal | null): Response => {
    if (refusal === null) return new Response(null, { status: 204 });
    throw failure(refusal === "not_found" ? 404 : 403, refusal);
  };

  /** Makes a playlist of the session's account collaborative; the account is its owner. */
  const makeCollaborative = withSession(async ({ request }, session) => {
    const body = await readJson(request);
    const playlistId =
      typeof body === "object" && body !== null && "playlistId" in body
        ? body.playlistId
        : undefined;
    if (typeof playlistId !== "string" || playlistId === "") throw failure(400, "bad_request");
    const made = await makeCollaboration(db, playlistId, session.accountId, now());
    if (made === "no_playlist") throw failure(404, "not_found");
    if (made === "taken") throw failure(409, "taken");
    return json(made);
  });

  const endCollaborative = withSession(async ({ url }, session) =>
    settled(await endCollaboration(db, playlistAsked(url), session.accountId, now())),
  );

  const listMembers = withSession(async ({ url }, session) => {
    const collaboration = await collaborationMembers(db, playlistAsked(url), session.accountId);
    if (collaboration === "not_member") throw failure(403, "not_member");
    return json(collaboration);
  });

  const removeOneMember = withSession(async ({ url }, session) => {
    const memberId = url.searchParams.get("account");
    if (memberId === null || memberId === "") throw failure(400, "bad_request");
    return settled(await removeMember(db, playlistAsked(url), session.accountId, memberId, now()));
  });

  /** A member's push of one collaborative playlist's row and entries (`pushPlaylistRows`). */
  const pushPlaylist = withSession(async ({ request, url }, session) => {
    const playlistId = playlistAsked(url);
    const result = await pushPlaylistRows(
      db,
      playlistId,
      session.accountId,
      parsePush(await readJson(request)),
      limits,
      now(),
    );
    if ("invalid" in result) throw invalid(result.invalid);
    if ("refused" in result) throw failure(403, result.refused);
    if ("overLimit" in result) throw overLimit(result.overLimit);
    return json({ accepted: result.accepted, corrected: result.corrected });
  });

  /** A member's pull of one collaborative playlist, after the cursor the last one gave. */
  const pullPlaylist = withSession(async ({ url }, session) => {
    const playlistId = playlistAsked(url);
    // A cursor is the owner's change number and the owner it is of (one from before names none).
    const since = /^(\d{1,15})(?:_([0-9A-Za-z-]{1,64}))?$/.exec(
      url.searchParams.get("since") ?? "0",
    );
    if (since === null) throw failure(400, "bad_request");
    const page = await pullPlaylistRows(
      db,
      playlistId,
      session.accountId,
      Number(since[1]),
      since[2] ?? null,
      pullPageSize,
    );
    if (page === null) throw failure(403, "not_member");
    return json({ ...page.rows, cursor: `${page.cursor}_${page.ownerId}`, more: page.more });
  });

  const leaveCollaborative = withSession(async ({ url }, session) =>
    settled(await leaveCollaboration(db, playlistAsked(url), session.accountId, now())),
  );

  /** What an owner's request about the invite link answers when it's refused: 403. */
  const ownerOnly = (refusal: InviteOwnerRefusal | null): Response => {
    if (refusal === null) return new Response(null, { status: 204 });
    throw failure(403, refusal);
  };

  /**
   * Creates the playlist's invite link, ending the active one. Answers the
   * link, an https address on this service with the token after `#` (so a
   * browser never sends it), and its expiry.
   */
  const createInviteLink = withSession(async ({ request, url }, session) => {
    const body = await readJson(request);
    const playlistId =
      typeof body === "object" && body !== null && "playlistId" in body
        ? body.playlistId
        : undefined;
    if (typeof playlistId !== "string" || playlistId === "") throw failure(400, "bad_request");
    const token = base64url(crypto.getRandomValues(new Uint8Array(32)));
    const made = await createInvite(
      db,
      playlistId,
      session.accountId,
      await sha256Hex(token),
      now(),
    );
    if (typeof made === "string") throw failure(403, made);
    return json({ url: `${url.origin}/invite#${token}`, expiresAt: made.expiresAt });
  });

  const readInviteLink = withSession(async ({ url }, session) => {
    const current = await currentInvite(db, playlistAsked(url), session.accountId, now());
    if (typeof current === "string") throw failure(403, current);
    return json(current);
  });

  const turnOffInviteLink = withSession(async ({ url }, session) =>
    ownerOnly(await turnOffInvite(db, playlistAsked(url), session.accountId)),
  );

  /**
   * The hash of the body's invite token. A token that can't be one counts
   * as a wrong one: 404, in the address's failed lookups.
   */
  const inviteTokenHash = async ({ request, addressKey }: RouteContext): Promise<string> => {
    const body = await readJson(request);
    const token =
      typeof body === "object" && body !== null && "token" in body ? body.token : undefined;
    if (typeof token !== "string" || !SESSION_TOKEN.test(token)) {
      return wrongInvite(addressKey);
    }
    return sha256Hex(token);
  };

  /** Refuses a token that names no invite, counting it as a failed lookup of the address. */
  const wrongInvite = async (addressKey: string | null): Promise<never> => {
    refused("unknown_invite");
    if (addressKey !== null) await countFailedLookup(addressKey);
    throw failure(404, "not_found");
  };

  /** 410 for an invite that no longer lets anyone in, and a wrong token's 404. */
  const inviteRefused = async (
    refusal: "unknown" | "ended",
    { addressKey }: RouteContext,
  ): Promise<never> => {
    if (refusal === "unknown") return wrongInvite(addressKey);
    throw failure(410, "invite_ended");
  };

  /** The playlist's and the owner's names, for the app to ask before joining. */
  const lookUpInvite = withSession(async (context) => {
    const summary = await readInvite(db, await inviteTokenHash(context), now());
    if (typeof summary === "string") return inviteRefused(summary, context);
    return json(summary);
  });

  /** Makes the session's account a member; answers the playlist's collaboration. */
  const joinWithInvite = withSession(async (context, session) => {
    const joined = await joinInvite(db, await inviteTokenHash(context), session.accountId, now());
    if (typeof joined === "string") return inviteRefused(joined, context);
    return json(joined);
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

  const upstream: Upstream = options.upstream ?? {
    fetch: (url, init) => fetch(url, init),
    cache: null,
  };

  /**
   * Counts one of [accountId]'s requests on its `upstream_usage` [row] today
   * (UTC), refusing with 429 past [limit] until the next day.
   */
  const countUpstream = async (
    accountId: string,
    row: string,
    limit: SyncLimitName,
  ): Promise<void> => {
    const at = now();
    const day = Math.floor(at / DAY_MS);
    const result = await db.execute({
      sql: `INSERT INTO upstream_usage (account_id, upstream, day, count) VALUES (?, ?, ?, 1)
            ON CONFLICT (account_id, upstream) DO UPDATE SET
              count = CASE WHEN day = excluded.day THEN count + 1 ELSE 1 END,
              day = excluded.day
            RETURNING count`,
      args: [accountId, row, day],
    });
    if (Number(result.rows[0]?.count) > limits[limit]) {
      throw new Answer(
        json({ error: "limit", limit }, 429, {
          "retry-after": String(Math.ceil(((day + 1) * DAY_MS - at) / 1000)),
        }),
      );
    }
  };

  /** A provider the service answers fixed requests to. */
  interface Provider {
    /** Its name in the log. */
    readonly name: string;
    readonly access: ProviderAccess | undefined;
    readonly perMinute: SyncLimitName;
    /**
     * What a request to [url] counts toward in a UTC day: its `upstream_usage`
     * row and limit, and whether answers from the cache count too (else only
     * those the provider makes).
     */
    readonly perDay: (url: URL) => {
      readonly row: string;
      readonly limit: SyncLimitName;
      readonly cachedAnswersCount: boolean;
    };
    /** The provider request a phone's [url] stands for, with the Worker's [key]; null for none. */
    readonly request: (url: URL, key: string) => UpstreamRequest | null;
    /** How far apart its requests start, when it takes only so many a second. */
    readonly spacingMs?: number;
  }

  const wait =
    options.wait ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));

  /**
   * Takes [provider]'s next turn: how long to wait before asking it, or null
   * when the turns already taken reach past `MAX_TURN_WAIT_MS`.
   */
  const takeTurn = (provider: Provider): number | null => {
    if (provider.spacingMs === undefined) return 0;
    const at = now();
    const start = Math.max(at, memory.upstreamTurns.get(provider.name) ?? -Infinity);
    if (start - at > MAX_TURN_WAIT_MS) return null;
    memory.upstreamTurns.set(provider.name, start + provider.spacingMs);
    return start - at;
  };

  /**
   * A route answering [provider]'s fixed requests: it needs a session and
   * counts the account's requests per minute and per day (`perDay` says
   * whether a cached answer counts toward the day); one the cache can't
   * answer waits its turn with a paced provider. Answers the provider's JSON, or `{ "error": "upstream_failed" }`
   * (502) when the provider fails, with nothing of the provider's error, and
   * `{ "error": "busy" }` (503) when too many requests wait their turn.
   */
  const proxied = (provider: Provider): Route =>
    withSession(async ({ url }, session) => {
      const { access } = provider;
      if (access === undefined) throw failure(503, "unavailable");
      if (!(await access.limiter.limit({ key: session.accountId })).success) {
        throw tooMany(provider.perMinute, now());
      }
      const request = provider.request(url, access.token);
      if (request === null) throw failure(400, "bad_request");
      const day = provider.perDay(url);
      if (day.cachedAnswersCount) await countUpstream(session.accountId, day.row, day.limit);
      const cached = await cachedAnswer(upstream, url.origin, request);
      if (cached !== null) return proxiedAnswer(cached);
      const turn = takeTurn(provider);
      if (turn === null) throw failure(503, "busy");
      if (!day.cachedAnswersCount) await countUpstream(session.accountId, day.row, day.limit);
      if (turn > 0) await wait(turn);
      const answer = await askUpstream(upstream, request);
      if (!answer.ok) {
        // The status alone: the request names a song or an artist.
        log(`sync service: ${provider.name} answered ${answer.status ?? "nothing"}`);
        throw failure(502, "upstream_failed");
      }
      await keepAnswer(upstream, url.origin, request, answer.body);
      return proxiedAnswer(answer.body);
    });

  /** Genius's search, song and referents, as the Lyrics view asks them (`@wave/core`'s `geniusProxy.ts`). */
  const genius = proxied({
    name: "genius",
    access: options.genius,
    perMinute: "maxGeniusRequestsPerMinute",
    perDay: () => ({ row: "genius", limit: "maxGeniusRequestsPerDay", cachedAnswersCount: false }),
    request: (url, token) => {
      const target = geniusUpstreamUrl(url.pathname, url.searchParams);
      return target === null
        ? null
        : {
            url: target,
            cacheKey: target,
            headers: { authorization: `Bearer ${token}`, accept: "application/json" },
            ttlSeconds: GENIUS_TTL_SECONDS,
            secrets: [token],
          };
    },
  });

  /**
   * Ticketmaster Discovery's attraction search and events, as a show check
   * asks them (`@wave/core`'s `ticketmasterProxy.ts`). Its key goes in the
   * URL, so the cache key is the URL without it.
   */
  const ticketmaster = proxied({
    name: "ticketmaster",
    access: options.ticketmaster,
    perMinute: "maxTicketmasterRequestsPerMinute",
    perDay: (url) =>
      url.pathname === "/v1/ticketmaster/attractions"
        ? {
            row: "ticketmaster:attractions",
            limit: "maxTicketmasterAttractionSearchesPerDay",
            cachedAnswersCount: true,
          }
        : {
            row: "ticketmaster:events",
            limit: "maxTicketmasterEventLookupsPerDay",
            cachedAnswersCount: true,
          },
    spacingMs: TICKETMASTER_SPACING_MS,
    request: (url, key) => {
      const target = ticketmasterUpstreamUrl(url.pathname, url.searchParams);
      return target === null
        ? null
        : {
            url: `${target}&apikey=${encodeURIComponent(key)}`,
            cacheKey: target,
            headers: { accept: "application/json" },
            ttlSeconds: TICKETMASTER_TTL_SECONDS,
            secrets: [key],
          };
    },
  });

  /** Each route by method and path. */
  const routes: Readonly<Record<string, Route>> = {
    "POST /v1/session": createSession,
    "DELETE /v1/session": endSession,
    "DELETE /v1/sessions": endAllSessions,
    "POST /v1/push": pushChanges,
    "GET /v1/pull": pullChanges,
    "DELETE /v1/account": removeAccount,
    "PUT /v1/account/name": putAccountName,
    "POST /v1/collaboration": makeCollaborative,
    "DELETE /v1/collaboration": endCollaborative,
    "GET /v1/collaboration/members": listMembers,
    "DELETE /v1/collaboration/members": removeOneMember,
    "DELETE /v1/collaboration/membership": leaveCollaborative,
    "POST /v1/collaboration/invite": createInviteLink,
    "GET /v1/collaboration/invite": readInviteLink,
    "DELETE /v1/collaboration/invite": turnOffInviteLink,
    "POST /v1/invite": lookUpInvite,
    "POST /v1/invite/join": joinWithInvite,
    "GET /invite": async ({ request }) => invitePage(request.headers.get("accept-language")),
    "GET /.well-known/assetlinks.json": async () => assetLinks(),
    "POST /v1/collaboration/push": pushPlaylist,
    "GET /v1/collaboration/pull": pullPlaylist,
    "PUT /v1/soulseek": putSoulseek,
    "GET /v1/soulseek": getSoulseek,
    "GET /v1/genius/search": genius,
    "GET /v1/genius/song": genius,
    "GET /v1/genius/referents": genius,
    "GET /v1/ticketmaster/attractions": ticketmaster,
    "GET /v1/ticketmaster/events": ticketmaster,
  };

  return async (request) => {
    // Cloudflare sets it on every request that reaches the Worker; only the
    // tests leave it out. Kept only as a hash, and never logged.
    const address = request.headers.get("cf-connecting-ip");
    const addressKey = address === null ? null : await sha256Hex(address);
    try {
      if (
        addressKey !== null &&
        !(await options.addressLimiter.limit({ key: addressKey })).success
      ) {
        refused("address_limit");
        throw tooMany("maxRequestsPerAddressPerMinute", now());
      }
      const url = new URL(request.url);
      const route = routes[`${request.method} ${url.pathname}`];
      if (route === undefined) return json({ error: "not_found" }, 404);
      return await route({ request, url, addressKey });
    } catch (error) {
      if (error instanceof Answer) return error.response;
      // The message only: a request, and so a token, never reaches the log.
      console.error("sync service error:", error instanceof Error ? error.message : "unknown");
      return json({ error: "internal" }, 500);
    }
  };
};
