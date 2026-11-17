/**
 * Runs the sync database's pending migrations against TURSO_DATABASE_URL
 * (with TURSO_AUTH_TOKEN), taken from the shell's environment.
 * `pnpm --filter @wave/sync deploy` runs it before `wrangler deploy`.
 *
 * It then stops the deploy (exit 1) when the database holds more accounts
 * than `SYNC_LIMITS.maxAccounts`: the owner chooses how to get there, and
 * nothing here picks accounts to keep or removes any.
 */

import { createClient } from "@libsql/client";
import { SYNC_LIMITS } from "../src/limits.ts";
import { migrate } from "../src/migrations.ts";

const url = process.env.TURSO_DATABASE_URL;
if (url === undefined || url === "") {
  console.error("Set TURSO_DATABASE_URL (and TURSO_AUTH_TOKEN for Turso) to migrate.");
  process.exit(1);
}
const authToken = process.env.TURSO_AUTH_TOKEN;
const db = createClient({ url, ...(authToken === undefined ? {} : { authToken }) });
try {
  const ran = await migrate(db);
  console.log(ran.length === 0 ? "The database is up to date." : `Ran ${ran.join(", ")}.`);
  const held = await db.execute("SELECT count(*) AS n FROM accounts");
  const accounts = Number(held.rows[0]?.n);
  if (accounts > SYNC_LIMITS.maxAccounts) {
    console.error(
      `The database holds ${accounts} accounts and maxAccounts is ${SYNC_LIMITS.maxAccounts}. ` +
        "Not deploying: choose a transition before admitting accounts this way.",
    );
    process.exitCode = 1;
  }
} finally {
  db.close();
}
