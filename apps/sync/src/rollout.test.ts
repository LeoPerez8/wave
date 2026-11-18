import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { createClient } from "@libsql/client";
import { migrate } from "./migrations.ts";
import { harness } from "./testing.ts";

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), "..", "scripts", "migrate.ts");

/** A database file holding [accounts] accounts, made by signing in. */
const databaseWith = async (accounts: number): Promise<string> => {
  const dir = mkdtempSync(join(tmpdir(), "wave-sync-rollout-"));
  const url = `file:${join(dir, "sync.db").replaceAll("\\", "/")}`;
  const db = createClient({ url });
  after(() => {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // Windows can hold the file a moment after closing; it's a temp dir.
    }
  });
  await migrate(db);
  const service = await harness({ limits: { maxAccounts: 100, maxNewAccountsPerDay: 100 } }, db);
  for (let n = 1; n <= accounts; n++) {
    const response = await service.request("POST", "/v1/session", {
      json: {
        idToken: await service.google.idToken({ sub: `sub-${n}`, email: `p${n}@example.com` }),
      },
    });
    assert.equal(response.status, 200);
  }
  db.close();
  return url;
};

/** An empty database file's URL, deleted when the test file ends. */
const emptyDatabase = (): string => {
  const dir = mkdtempSync(join(tmpdir(), "wave-sync-rollout-"));
  after(() => {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // Windows can hold the file a moment after closing; it's a temp dir.
    }
  });
  return `file:${join(dir, "sync.db").replaceAll("\\", "/")}`;
};

/** The migrations [url]'s database has run. */
const migrationsRun = async (url: string): Promise<string[]> => {
  const db = createClient({ url });
  try {
    const result = await db.execute("SELECT id FROM migrations ORDER BY id");
    return result.rows.map((row) => String(row.id));
  } finally {
    db.close();
  }
};

/** Runs the deploy's migration step against [url], as `pnpm run deploy` does before `wrangler deploy`. */
const runDeployMigration = (url: string) => {
  const { TURSO_AUTH_TOKEN: _, ...env } = process.env;
  return spawnSync(process.execPath, [SCRIPT], {
    env: { ...env, TURSO_DATABASE_URL: url },
    encoding: "utf8",
  });
};

describe("the deploy's account-capacity stop", () => {
  test("lets the deploy go on with ten accounts", async () => {
    const run = runDeployMigration(await databaseWith(10));
    assert.equal(run.status, 0, run.stderr);
  });

  test("stops the deploy when more accounts exist than the service admits, removing none", async () => {
    const url = await databaseWith(11);
    const run = runDeployMigration(url);
    assert.equal(run.status, 1);
    assert.match(run.stderr, /11 accounts/);
    assert.match(run.stderr, /maxAccounts is 10/);
    const db = createClient({ url });
    try {
      const held = await db.execute("SELECT count(*) AS n FROM accounts");
      assert.equal(Number(held.rows[0]?.n), 11);
    } finally {
      db.close();
    }
  });

  test("a stopped deploy leaves the schema as it was: no pending migration runs", async () => {
    const url = emptyDatabase();
    const db = createClient({ url });
    try {
      await migrate(db, { until: "0012_upstream_usage" });
      for (let n = 1; n <= 11; n++) {
        await db.execute({
          sql: "INSERT INTO accounts (id, google_sub, email, created_at) VALUES (?, ?, ?, ?)",
          args: [`account-${n}`, `sub-${n}`, `p${n}@example.com`, n],
        });
      }
    } finally {
      db.close();
    }
    const before = await migrationsRun(url);

    const run = runDeployMigration(url);
    assert.equal(run.status, 1);
    assert.match(run.stderr, /11 accounts/);
    assert.deepEqual(await migrationsRun(url), before);
    assert.ok(!before.includes("0013_usage_warnings"));
  });

  test("a database with no tables yet gets every migration", async () => {
    const url = emptyDatabase();
    const run = runDeployMigration(url);
    assert.equal(run.status, 0, run.stderr);
    assert.ok((await migrationsRun(url)).includes("0013_usage_warnings"));
  });
});
