/**
 * Runs the sync database's pending migrations against TURSO_DATABASE_URL
 * (with TURSO_AUTH_TOKEN), taken from the shell's environment.
 * `pnpm --filter @wave/sync deploy` runs it before `wrangler deploy`.
 */

import { createClient } from "@libsql/client";
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
} finally {
  db.close();
}
