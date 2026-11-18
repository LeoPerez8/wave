/**
 * Runs the sync database's pending migrations against TURSO_DATABASE_URL
 * (with TURSO_AUTH_TOKEN), taken from the shell's environment.
 * `pnpm --filter @wave/sync deploy` runs it before `wrangler deploy`.
 *
 * Before any migration it stops the deploy (exit 1) when the database holds
 * more accounts than `SYNC_LIMITS.maxAccounts`, leaving the schema as it
 * was: the owner chooses how to get there, and nothing here picks accounts
 * to keep or removes any.
 */

import { type Client, createClient } from "@libsql/client";
import { SYNC_LIMITS } from "../src/limits.ts";
import { migrate } from "../src/migrations.ts";

/** How many accounts [db] holds; none when it has no accounts table yet. Only reads. */
const accountCount = async (db: Client): Promise<number> => {
  const table = await db.execute(
    "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'accounts'",
  );
  if (table.rows.length === 0) return 0;
  const held = await db.execute("SELECT count(*) AS n FROM accounts");
  return Number(held.rows[0]?.n);
};

const url = process.env.TURSO_DATABASE_URL;
if (url === undefined || url === "") {
  console.error("Set TURSO_DATABASE_URL (and TURSO_AUTH_TOKEN for Turso) to migrate.");
  process.exit(1);
}
const authToken = process.env.TURSO_AUTH_TOKEN;
const db = createClient({ url, ...(authToken === undefined ? {} : { authToken }) });
try {
  const accounts = await accountCount(db);
  if (accounts > SYNC_LIMITS.maxAccounts) {
    console.error(
      `The database holds ${accounts} accounts and maxAccounts is ${SYNC_LIMITS.maxAccounts}. ` +
        "Not migrating or deploying: choose a transition before admitting accounts this way.",
    );
    process.exitCode = 1;
  } else {
    const ran = await migrate(db);
    console.log(ran.length === 0 ? "The database is up to date." : `Ran ${ran.join(", ")}.`);
  }
} finally {
  db.close();
}
