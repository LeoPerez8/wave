/**
 * The hourly usage watch (the Worker's Cron Trigger). It reads today's requests to every Worker
 * on the account from Cloudflare's GraphQL Analytics API and compares them with
 * `USAGE_WARNINGS`. Past the threshold it writes one line starting `wave usage warning:`, at most
 * once a UTC day; when it can't read them it writes the same kind of line, once a day. A
 * Cloudflare notification turns those lines into an email (see README.md). No line carries a
 * token or the account. Turso's usage is checked by hand (README.md): a Turso Platform token
 * could do far more than read it, so the Worker that holds the database holds none.
 */

import type { Client } from "@libsql/client";
import { type UsageWarnings, USAGE_WARNINGS } from "./limits.ts";

/** The Worker secrets the watch reads; without both it is skipped. */
export interface UsageSecrets {
  readonly CLOUDFLARE_ACCOUNT_ID?: string | undefined;
  /** A Cloudflare API token with only Account › Account Analytics › Read. */
  readonly CLOUDFLARE_ANALYTICS_TOKEN?: string | undefined;
}

export interface UsageWatchOptions {
  /** Remembers which warnings were written. */
  readonly db: Client;
  readonly secrets: UsageSecrets;
  readonly fetch?: typeof fetch;
  readonly now?: () => number;
  readonly thresholds?: UsageWarnings;
  /** Where warning lines go (`console.error` by default). */
  readonly warn?: (message: string) => void;
  /** Where other lines go (`console.log` by default). */
  readonly note?: (message: string) => void;
}

/** Why the figures couldn't be read, safe to log: an HTTP status or a short reason. */
class Unreadable extends Error {}

const GRAPHQL_URL = "https://api.cloudflare.com/client/v4/graphql";

const REQUESTS_QUERY = `query WorkerRequests($accountTag: string!, $since: Time!, $until: Time!) {
  viewer {
    accounts(filter: { accountTag: $accountTag }) {
      workersInvocationsAdaptive(limit: 1000, filter: { datetime_geq: $since, datetime_leq: $until }) {
        sum { requests }
        dimensions { scriptName }
      }
    }
  }
}`;

interface RequestsAnswer {
  readonly data?: {
    readonly viewer?: {
      readonly accounts?: readonly {
        readonly workersInvocationsAdaptive?: readonly {
          readonly sum?: { readonly requests?: unknown };
        }[];
      }[];
    };
  } | null;
  readonly errors?: readonly unknown[] | null;
}

/** Cloudflare gets this long to answer, so a hung request can't hold the cron run. */
const TIMEOUT_MS = 15_000;

/** `2026-11-06T15:00:00.000Z` → `2026-11-06T15:00:00Z`, the form the GraphQL API takes. */
const isoSeconds = (at: number): string => new Date(at).toISOString().replace(/\.\d{3}Z$/, "Z");

const isCount = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0;

/** Fetches [url] and gives its JSON body, or throws `Unreadable`. */
const fetchJson = async (
  fetcher: typeof fetch,
  url: string,
  init: RequestInit,
): Promise<unknown> => {
  let response: Response;
  try {
    response = await fetcher(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch {
    throw new Unreadable("no answer");
  }
  if (!response.ok) throw new Unreadable(`HTTP ${response.status}`);
  try {
    return await response.json();
  } catch {
    throw new Unreadable("an answer that isn't JSON");
  }
};

/** Today's requests to every Worker on the account, or throws `Unreadable`. */
const workerRequests = async (
  fetcher: typeof fetch,
  accountTag: string,
  token: string,
  at: number,
  day: string,
): Promise<number> => {
  const answer = (await fetchJson(fetcher, GRAPHQL_URL, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({
      query: REQUESTS_QUERY,
      variables: { accountTag, since: `${day}T00:00:00Z`, until: isoSeconds(at) },
    }),
  })) as RequestsAnswer;
  // GraphQL errors (a token without the permission, a wrong account) come with a 200.
  if (answer.errors != null && answer.errors.length > 0) throw new Unreadable("a GraphQL error");
  const rows = answer.data?.viewer?.accounts?.[0]?.workersInvocationsAdaptive;
  if (rows === undefined) throw new Unreadable("no figures");
  // Workers Free's daily cap is account-wide, so every Worker counts.
  let total = 0;
  for (const row of rows) {
    const requests = row.sum?.requests;
    if (!isCount(requests)) throw new Unreadable("no figures");
    total += requests;
  }
  return total;
};

export const watchUsage = async (options: UsageWatchOptions): Promise<void> => {
  const { db, secrets } = options;
  const fetcher = options.fetch ?? fetch;
  const thresholds = options.thresholds ?? USAGE_WARNINGS;
  const warn = options.warn ?? ((message: string) => console.error(message));
  const note = options.note ?? ((message: string) => console.log(message));
  const at = (options.now ?? Date.now)();
  const day = new Date(at).toISOString().slice(0, 10);

  /** Writes [message] unless the warning [name] for [period] was written already. */
  const warnOnce = async (name: string, period: string, message: string): Promise<void> => {
    try {
      const result = await db.execute({
        sql: "INSERT OR IGNORE INTO usage_warnings (name, period, warned_at) VALUES (?, ?, ?)",
        args: [name, period, at],
      });
      if (result.rowsAffected === 0) return;
    } catch {
      // The database can't remember it (it may be the thing over its limit): warn anyway.
    }
    warn(`wave usage warning: ${message}`);
  };

  const { CLOUDFLARE_ACCOUNT_ID: account, CLOUDFLARE_ANALYTICS_TOKEN: token } = secrets;
  if (!account || !token) {
    note(
      "usage watch: Cloudflare's Worker requests skipped, CLOUDFLARE_ACCOUNT_ID or CLOUDFLARE_ANALYTICS_TOKEN isn't set",
    );
    return;
  }
  let requests: number;
  try {
    requests = await workerRequests(fetcher, account, token, at, day);
  } catch (error) {
    const reason = error instanceof Unreadable ? error.message : "an error";
    await warnOnce(
      "cloudflareUnreadable",
      day,
      `couldn't read Cloudflare's Worker requests (${reason}) on ${day}`,
    );
    return;
  }
  const threshold = thresholds.workerRequestsPerDay;
  if (requests >= threshold) {
    await warnOnce(
      "workerRequestsPerDay",
      day,
      `workerRequestsPerDay at ${requests}, past ${threshold} (${day} UTC)`,
    );
  }
};
