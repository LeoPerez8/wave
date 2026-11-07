/**
 * The hourly usage watch (the Worker's Cron Trigger). It reads today's requests to every Worker
 * on the account from Cloudflare's GraphQL Analytics API, and this billing cycle's Turso usage
 * from Turso's Platform API, and compares them with `USAGE_WARNINGS`. Past a threshold it writes
 * one line starting `wave usage warning:`, at most once a period (a UTC day for Worker requests,
 * a UTC month for Turso); a source it can't read gets the same kind of line, once a day. A
 * Cloudflare notification turns those lines into an email (see README.md). No line carries a
 * token, the account or the organization.
 */

import type { Client } from "@libsql/client";
import { type UsageWarnings, USAGE_WARNINGS } from "./limits.ts";

/** The Worker secrets the watch reads; a source whose secrets aren't all set is skipped. */
export interface UsageSecrets {
  readonly CLOUDFLARE_ACCOUNT_ID?: string | undefined;
  /** A Cloudflare API token with only Account › Account Analytics › Read. */
  readonly CLOUDFLARE_ANALYTICS_TOKEN?: string | undefined;
  /** The Turso organization's slug. */
  readonly TURSO_ORG?: string | undefined;
  /** A Turso Platform API token for that organization. */
  readonly TURSO_PLATFORM_TOKEN?: string | undefined;
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

/** One figure read from a source, with the threshold it's held to and the period it counts. */
interface Reading {
  readonly name: keyof UsageWarnings;
  readonly value: number;
  readonly period: string;
}

/** Why a source couldn't be read, safe to log: an HTTP status or a short reason. */
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

interface TursoAnswer {
  readonly organization?: {
    readonly usage?: {
      readonly rows_read?: unknown;
      readonly rows_written?: unknown;
      readonly storage_bytes?: unknown;
    };
  };
}

/** Upstreams get this long to answer, so a hung one can't hold the cron run. */
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

const workerRequests = async (
  fetcher: typeof fetch,
  accountTag: string,
  token: string,
  at: number,
  day: string,
): Promise<Reading[]> => {
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
  return [{ name: "workerRequestsPerDay", value: total, period: day }];
};

const tursoUsage = async (
  fetcher: typeof fetch,
  organization: string,
  token: string,
  month: string,
): Promise<Reading[]> => {
  const url = `https://api.turso.tech/v1/organizations/${encodeURIComponent(organization)}/usage`;
  const answer = (await fetchJson(fetcher, url, {
    headers: { authorization: `Bearer ${token}` },
  })) as TursoAnswer;
  const usage = answer.organization?.usage;
  const figures = [usage?.rows_read, usage?.rows_written, usage?.storage_bytes];
  if (!figures.every(isCount)) throw new Unreadable("no figures");
  const [rowsRead, rowsWritten, storageBytes] = figures as [number, number, number];
  return [
    { name: "tursoRowsReadPerMonth", value: rowsRead, period: month },
    { name: "tursoRowsWrittenPerMonth", value: rowsWritten, period: month },
    { name: "tursoStorageBytes", value: storageBytes, period: month },
  ];
};

export const watchUsage = async (options: UsageWatchOptions): Promise<void> => {
  const { db, secrets } = options;
  const fetcher = options.fetch ?? fetch;
  const thresholds = options.thresholds ?? USAGE_WARNINGS;
  const warn = options.warn ?? ((message: string) => console.error(message));
  const note = options.note ?? ((message: string) => console.log(message));
  const at = (options.now ?? Date.now)();
  const day = new Date(at).toISOString().slice(0, 10);
  const month = day.slice(0, 7);

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

  const sources: {
    readonly label: string;
    readonly key: string;
    readonly secretNames: string;
    readonly read: (() => Promise<Reading[]>) | undefined;
  }[] = [
    {
      label: "Cloudflare's Worker requests",
      key: "cloudflareUnreadable",
      secretNames: "CLOUDFLARE_ACCOUNT_ID or CLOUDFLARE_ANALYTICS_TOKEN",
      read: (() => {
        const { CLOUDFLARE_ACCOUNT_ID: account, CLOUDFLARE_ANALYTICS_TOKEN: token } = secrets;
        if (!account || !token) return undefined;
        return () => workerRequests(fetcher, account, token, at, day);
      })(),
    },
    {
      label: "Turso's usage",
      key: "tursoUnreadable",
      secretNames: "TURSO_ORG or TURSO_PLATFORM_TOKEN",
      read: (() => {
        const { TURSO_ORG: organization, TURSO_PLATFORM_TOKEN: token } = secrets;
        if (!organization || !token) return undefined;
        return () => tursoUsage(fetcher, organization, token, month);
      })(),
    },
  ];

  for (const source of sources) {
    if (source.read === undefined) {
      note(`usage watch: ${source.label} skipped, ${source.secretNames} isn't set`);
      continue;
    }
    let readings: Reading[];
    try {
      readings = await source.read();
    } catch (error) {
      const reason = error instanceof Unreadable ? error.message : "an error";
      await warnOnce(source.key, day, `couldn't read ${source.label} (${reason}) on ${day}`);
      continue;
    }
    for (const { name, value, period } of readings) {
      const threshold = thresholds[name];
      if (value >= threshold) {
        await warnOnce(name, period, `${name} at ${value}, past ${threshold} (${period} UTC)`);
      }
    }
  }
};
