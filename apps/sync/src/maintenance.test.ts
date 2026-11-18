import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { Client, InStatement } from "@libsql/client";
import { runMaintenance } from "./maintenance.ts";
import { type Harness, favorite, harness, pull, push, sessionCount } from "./testing.ts";

const DAY = 24 * 60 * 60 * 1000;

const ANALYTICS = {
  CLOUDFLARE_ACCOUNT_ID: "0123456789abcdef0123456789abcdef",
  CLOUDFLARE_ANALYTICS_TOKEN: "cf-analytics-token-for-tests",
};

/** Two accounts: Ana with a session left unused past 90 days and one in use, Bo with one in use. */
const accountsWithStaleSessions = async () => {
  const service = await harness();
  const stale = await service.signIn();
  await push(service, stale, { favorites: [favorite("k1", 1)] });
  service.now += 60 * DAY;
  const ana = await service.signIn();
  const bo = await service.signIn({ sub: "google-sub-2", email: "bo@example.com" });
  service.now += 30 * DAY + 1;
  return { service, stale, ana, bo };
};

/** The hourly run at the harness's time, with [options] for the usage watch. */
const maintain = async (
  service: Harness,
  options: {
    readonly secrets?: typeof ANALYTICS | Record<string, never>;
    readonly fetch?: typeof fetch;
    readonly db?: Client;
  } = {},
) => {
  const warnings: string[] = [];
  const notes: string[] = [];
  await runMaintenance({
    db: options.db ?? service.db,
    secrets: options.secrets ?? {},
    fetch: options.fetch ?? (async () => new Response("{}", { status: 500 })),
    now: () => service.now,
    warn: (message) => warnings.push(message),
    note: (message) => notes.push(message),
  });
  return { warnings, notes };
};

describe("the hourly maintenance", () => {
  test("deletes sessions unused for 90 days without their tokens coming back, and keeps the rest", async () => {
    const { service, ana, bo } = await accountsWithStaleSessions();
    assert.equal(await sessionCount(service), 3);

    await maintain(service);

    assert.equal(await sessionCount(service), 2);
    for (const session of [ana, bo]) {
      assert.equal((await service.request("GET", "/v1/pull", { session })).status, 200);
    }
    const pulled = await pull(service, ana);
    assert.deepEqual(
      pulled.favorites.map((row) => row.id),
      ["k1"],
    );
  });

  test("deletes them when Cloudflare's analytics can't be read", async () => {
    const { service } = await accountsWithStaleSessions();
    const { warnings } = await maintain(service, {
      secrets: ANALYTICS,
      fetch: async () => {
        throw new Error("no network");
      },
    });
    assert.equal(warnings.length, 1);
    assert.equal(await sessionCount(service), 2);
  });

  test("still watches usage when deleting sessions fails", async () => {
    const { service } = await accountsWithStaleSessions();
    const failingDeletes = new Proxy(service.db, {
      get: (target, property) => {
        const value: unknown = Reflect.get(target, property, target);
        if (property !== "execute" || typeof value !== "function") return value;
        return async (statement: InStatement) => {
          const sql = typeof statement === "string" ? statement : statement.sql;
          if (sql.includes("DELETE FROM sessions")) throw new Error("database busy");
          return (value as (statement: InStatement) => unknown).call(target, statement);
        };
      },
    });
    const { warnings } = await maintain(service, { secrets: ANALYTICS, db: failingDeletes });
    assert.deepEqual(warnings.sort(), [
      "maintenance: couldn't delete expired sessions",
      "wave usage warning: couldn't read Cloudflare's Worker requests (HTTP 500) on 2027-01-12",
    ]);
    assert.equal(await sessionCount(service), 3);
  });
});

describe("the hourly maintenance: usage warnings by month", () => {
  /** The periods of the warnings [service] still holds, after one run at [at]. */
  const keptAfterRun = async (at: number, periods: readonly string[]) => {
    const service = await harness();
    for (const period of periods) {
      await service.db.execute({
        sql: "INSERT INTO usage_warnings (name, period, warned_at) VALUES ('monthly', ?, 0)",
        args: [period],
      });
    }
    service.now = at;
    await maintain(service);
    const { rows } = await service.db.execute("SELECT period FROM usage_warnings ORDER BY period");
    return rows.map((row) => String(row.period));
  };

  test("keeps a month while any of its days is today or one of the 29 before", async () => {
    // Kept days: 2026-10-20 to 2026-11-18.
    assert.deepEqual(
      await keptAfterRun(Date.UTC(2026, 10, 18, 12), ["2026-09", "2026-10", "2026-11"]),
      ["2026-10", "2026-11"],
    );
  });

  test("forgets a month once its last day is older than the days kept", async () => {
    // Kept days: 2026-11-01 to 2026-11-30.
    assert.deepEqual(await keptAfterRun(Date.UTC(2026, 10, 30, 12), ["2026-10", "2026-11"]), [
      "2026-11",
    ]);
  });
});
