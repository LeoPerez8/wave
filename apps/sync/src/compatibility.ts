/**
 * The compatibility report (#1123): a read-only check, before the limits of
 * the security readiness spec (#1122) are switched on, that they wouldn't
 * interrupt how the service is used now. It counts; it never names an
 * account, a token, an email or a row, and never changes the database.
 */

import type { Client } from "@libsql/client";
import { SYNC_LIMITS } from "./limits.ts";
import { SESSION_UNUSED_MS } from "./sessions.ts";
import { SYNC_TABLES } from "./tables.ts";
import { WARNING_DAYS_KEPT } from "./usage.ts";

/**
 * The limits #1122 selects, beside each sync category's row quota (`SYNC_LIMITS`, tombstones
 * counted). Those the service already enforces come from where it keeps them.
 */
export const SELECTED_LIMITS = {
  accounts: SYNC_LIMITS.maxAccounts,
  /** Sessions unused for less than `SESSION_UNUSED_MS`, per account. */
  validSessionsPerAccount: SYNC_LIMITS.maxSessionsPerAccount,
  /** Sign-in counters (`sign_in_windows`) in the current minute, by address and Google account. */
  authCounters: SYNC_LIMITS.maxSignInKeysPerMinute,
  /** Days of usage warnings kept: today (UTC) and the days before. */
  usageWarningDays: WARNING_DAYS_KEPT,
  /** Usage warnings that can be kept: two kinds a day over `usageWarningDays`. */
  usageWarnings: 2 * WARNING_DAYS_KEPT,
  /** Provider-usage rows one account holds: one per counted category. */
  providerUsagePerAccount: 3,
} as const;

/** What only the owner can see on a phone with the installed Wave. */
export const INSTALLED_CLIENT_CHECKS = [
  "sign-in",
  "push-pull",
  "library-preserved",
  "sessions-preserved",
] as const;

export type InstalledClientCheck = (typeof INSTALLED_CLIENT_CHECKS)[number];

export interface ReportOptions {
  /** The database to count, read only. Without it the report can't pass. */
  readonly db?: Client;
  /** A name for where the counts come from, such as `production-sync`. Never a URL. */
  readonly environment: string;
  /** `live`: the deployed database. `fixture`: a local or test one, which never authorizes activation. */
  readonly source: "live" | "fixture";
  /** The commit of the service whose limits are checked, when there is one. */
  readonly sourceRevision?: string;
  /** When the counts are taken, in ms since the epoch. */
  readonly now: number;
  /** What the owner saw the installed app do; a check left out is still pending. */
  readonly installedClient?: Readonly<Partial<Record<InstalledClientCheck, "passed" | "failed">>>;
}

export interface Finding {
  readonly code: string;
  /** The account it's about, by its label in the report. */
  readonly account?: string;
  /** The sync category, session set or check it's about. */
  readonly subject?: string;
  readonly count?: number;
  readonly limit?: number;
}

interface Capacity {
  readonly count: number;
  readonly limit: number;
  readonly headroom: number;
}

interface Retained {
  readonly live: number;
  readonly tombstones: number;
  readonly retained: number;
  readonly limit: number;
  readonly headroom: number;
}

export interface AccountInventory {
  /** `account-1`, `account-2`… by when the account was made. */
  readonly label: string;
  readonly sessions: {
    readonly valid: number;
    readonly expired: number;
    readonly limit: number;
    readonly headroom: number;
  };
  readonly retained: Readonly<Record<string, Retained>>;
  /** Its provider-usage rows, one per counted category. */
  readonly providerUsage: { readonly rows: number; readonly limit: number };
}

export interface Inventory {
  readonly accounts: Capacity;
  readonly perAccount: readonly AccountInventory[];
  /** `current`: this minute's, which the limit counts; `stale`: older ones the next sign-in clears. */
  readonly authCounters: {
    readonly current: number;
    readonly stale: number;
    readonly limit: number;
    readonly headroom: number;
  };
  readonly usageWarnings: {
    readonly retained: number;
    /** Older than the days kept. */
    readonly outsideWindow: number;
    readonly limit: number;
  };
  readonly providerUsage: {
    readonly rows: number;
    readonly mostPerAccount: number;
    readonly limitPerAccount: number;
  };
}

export interface CompatibilityReport {
  readonly result: "compatible" | "incompatible" | "insufficient-evidence";
  readonly environment: string;
  readonly source: "live" | "fixture";
  readonly sourceRevision: string | null;
  readonly observedAt: string;
  readonly findings: readonly Finding[];
  readonly inventory: Inventory | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;

const readInventory = async (db: Client, now: number): Promise<Inventory> => {
  const validSince = now - SESSION_UNUSED_MS;
  const retained = SYNC_TABLES.flatMap((table) => [
    `(SELECT count(*) FROM ${table.sqlName} t WHERE t.account_id = a.id) AS "${table.name}"`,
    table.kind === "rows"
      ? `(SELECT count(*) FROM ${table.sqlName} t WHERE t.account_id = a.id AND t.deleted = 1) AS "${table.name}:deleted"`
      : `0 AS "${table.name}:deleted"`,
  ]);
  const minute = Math.floor(now / 60_000);
  const firstKeptDay = new Date(now - (SELECTED_LIMITS.usageWarningDays - 1) * DAY_MS)
    .toISOString()
    .slice(0, 10);
  // Counts only: no id, email, subject or key leaves the database.
  const [accounts, counters, warnings, providers] = await db.batch(
    [
      {
        sql: `SELECT
                (SELECT count(*) FROM sessions s WHERE s.account_id = a.id AND s.last_used_at > ?) AS valid,
                (SELECT count(*) FROM sessions s WHERE s.account_id = a.id AND s.last_used_at <= ?) AS expired,
                (SELECT count(*) FROM upstream_usage u WHERE u.account_id = a.id) AS provider_rows,
                ${retained.join(",\n")}
              FROM accounts a ORDER BY a.created_at, a.rowid`,
        args: [validSince, validSince],
      },
      {
        sql: `SELECT count(*) FILTER (WHERE window_start = ?) AS current,
                     count(*) FILTER (WHERE window_start <> ?) AS stale
              FROM sign_in_windows`,
        args: [minute, minute],
      },
      {
        sql: `SELECT count(*) AS retained, count(*) FILTER (WHERE period < ?) AS outside
              FROM usage_warnings`,
        args: [firstKeptDay],
      },
      {
        sql: `SELECT count(*) AS n FROM upstream_usage GROUP BY account_id ORDER BY n DESC`,
        args: [],
      },
    ],
    "read",
  );
  const perAccount = (accounts?.rows ?? []).map((row, index): AccountInventory => {
    const valid = Number(row.valid);
    return {
      label: `account-${index + 1}`,
      sessions: {
        valid,
        expired: Number(row.expired),
        limit: SELECTED_LIMITS.validSessionsPerAccount,
        headroom: SELECTED_LIMITS.validSessionsPerAccount - valid,
      },
      retained: Object.fromEntries(
        SYNC_TABLES.map((table) => {
          const count = Number(row[table.name]);
          const tombstones = Number(row[`${table.name}:deleted`]);
          const limit = SYNC_LIMITS[table.limit];
          return [
            table.name,
            {
              live: count - tombstones,
              tombstones,
              retained: count,
              limit,
              headroom: limit - count,
            },
          ];
        }),
      ),
      providerUsage: {
        rows: Number(row.provider_rows),
        limit: SELECTED_LIMITS.providerUsagePerAccount,
      },
    };
  });
  const current = Number(counters?.rows[0]?.current);
  const perProvider = (providers?.rows ?? []).map((row) => Number(row.n));
  return {
    accounts: {
      count: perAccount.length,
      limit: SELECTED_LIMITS.accounts,
      headroom: SELECTED_LIMITS.accounts - perAccount.length,
    },
    perAccount,
    authCounters: {
      current,
      stale: Number(counters?.rows[0]?.stale),
      limit: SELECTED_LIMITS.authCounters,
      headroom: SELECTED_LIMITS.authCounters - current,
    },
    usageWarnings: {
      retained: Number(warnings?.rows[0]?.retained),
      outsideWindow: Number(warnings?.rows[0]?.outside),
      limit: SELECTED_LIMITS.usageWarnings,
    },
    providerUsage: {
      rows: perProvider.reduce((sum, n) => sum + n, 0),
      mostPerAccount: perProvider[0] ?? 0,
      limitPerAccount: SELECTED_LIMITS.providerUsagePerAccount,
    },
  };
};

/** What the selected limits would refuse or leave over them, given [inventory]. */
const blockers = (inventory: Inventory): Finding[] => {
  const found: Finding[] = [];
  const { accounts } = inventory;
  if (accounts.count > accounts.limit) {
    found.push({ code: "accounts-over-limit", count: accounts.count, limit: accounts.limit });
  }
  for (const { label, sessions, retained, providerUsage } of inventory.perAccount) {
    // The categories are fixed, so all three in use is normal; more is a row the limit doesn't expect.
    if (providerUsage.rows > providerUsage.limit) {
      found.push({
        code: "provider-usage-over-limit",
        account: label,
        count: providerUsage.rows,
        limit: providerUsage.limit,
      });
    }
    // At the limit the next phone's sign-in is refused; over it, the sessions stay but no new one starts.
    if (sessions.valid >= sessions.limit) {
      found.push({
        code: sessions.valid > sessions.limit ? "sessions-over-limit" : "sessions-full",
        account: label,
        count: sessions.valid,
        limit: sessions.limit,
      });
    }
    // At the quota the next new id is refused; over it, what's held stays but nothing grows.
    for (const [category, held] of Object.entries(retained)) {
      if (held.retained >= held.limit) {
        found.push({
          code: held.retained > held.limit ? "retained-over-limit" : "retained-full",
          account: label,
          subject: category,
          count: held.retained,
          limit: held.limit,
        });
      }
    }
  }
  // A sign-in from a new address or account would need a counter the limit refuses.
  const { authCounters } = inventory;
  if (authCounters.current >= authCounters.limit) {
    found.push({
      code: "auth-counters-full",
      count: authCounters.current,
      limit: authCounters.limit,
    });
  }
  return found;
};

export const compatibilityReport = async (options: ReportOptions): Promise<CompatibilityReport> => {
  const inventory = options.db === undefined ? null : await readInventory(options.db, options.now);
  const blocking = inventory === null ? [] : blockers(inventory);
  const missing: Finding[] = inventory === null ? [{ code: "inventory-unavailable" }] : [];
  for (const check of INSTALLED_CLIENT_CHECKS) {
    const seen = options.installedClient?.[check];
    if (seen === "failed") blocking.push({ code: "installed-client-failed", subject: check });
    else if (seen !== "passed")
      missing.push({ code: "installed-client-unverified", subject: check });
  }
  const findings = [...blocking, ...missing];
  return {
    result:
      blocking.length > 0
        ? "incompatible"
        : missing.length > 0
          ? "insufficient-evidence"
          : "compatible",
    environment: options.environment,
    source: options.source,
    sourceRevision: options.sourceRevision ?? null,
    observedAt: new Date(options.now).toISOString(),
    findings,
    inventory,
  };
};

/** How old a report may be when the limits are switched on. */
export const REPORT_MAX_AGE_MS = 60 * 60 * 1000;

/**
 * Why [report] can't authorize switching on the limits for [sourceRevision]
 * at [now]; empty when it can. Taken again right before activation, so
 * counts from an earlier day, another revision or a test database never do.
 */
export const activationBlockers = (
  report: CompatibilityReport,
  { now, sourceRevision }: { readonly now: number; readonly sourceRevision: string },
): string[] => {
  const blockers: string[] = [];
  if (report.result !== "compatible") blockers.push(`result-${report.result}`);
  if (report.source !== "live") blockers.push("not-live");
  const age = now - Date.parse(report.observedAt);
  if (!(age >= 0 && age <= REPORT_MAX_AGE_MS)) blockers.push("report-stale");
  if (report.sourceRevision !== sourceRevision) blockers.push("revision-mismatch");
  return blockers;
};
