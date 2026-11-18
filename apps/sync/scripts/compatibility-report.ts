/**
 * Prints the compatibility report (src/compatibility.ts) for the sync
 * database at TURSO_DATABASE_URL (with TURSO_AUTH_TOKEN, a read-only token
 * for Turso), taken from the shell's environment. It only reads. Without the
 * database it still prints a dated report, of insufficient evidence.
 *
 *   node scripts/compatibility-report.ts --environment production-sync \
 *     --revision <commit> [--source live|fixture] \
 *     [--installed-client sign-in=passed,push-pull=passed,...]
 *
 * Exits 0 when compatible, 1 when incompatible and 2 on insufficient evidence.
 */

import { parseArgs } from "node:util";
import { createClient } from "@libsql/client";
import {
  type InstalledClientCheck,
  INSTALLED_CLIENT_CHECKS,
  compatibilityReport,
} from "../src/compatibility.ts";

const fail = (message: string): never => {
  console.error(message);
  process.exit(64);
};

const { values } = parseArgs({
  options: {
    environment: { type: "string" },
    revision: { type: "string" },
    source: { type: "string", default: "live" },
    "installed-client": { type: "string", default: "" },
  },
});

const environment = values.environment ?? "";
// A short name, so a URL or a credential can't end up in the report.
if (!/^[a-z0-9][a-z0-9-]{0,40}$/.test(environment)) {
  fail("Give --environment a short name such as production-sync (lower case, digits and -).");
}
const source = values.source;
if (source !== "live" && source !== "fixture") fail("--source is live or fixture.");

const installedClient: Partial<Record<InstalledClientCheck, "passed" | "failed">> = {};
for (const entry of values["installed-client"].split(",").filter((part) => part !== "")) {
  const [check, seen] = entry.split("=");
  if (!INSTALLED_CLIENT_CHECKS.includes(check as InstalledClientCheck)) {
    fail(`--installed-client checks are ${INSTALLED_CLIENT_CHECKS.join(", ")}.`);
  }
  if (seen !== "passed" && seen !== "failed") fail(`${check} is passed or failed.`);
  installedClient[check as InstalledClientCheck] = seen as "passed" | "failed";
}

const url = process.env.TURSO_DATABASE_URL;
const authToken = process.env.TURSO_AUTH_TOKEN;
const db =
  url === undefined || url === ""
    ? undefined
    : createClient({ url, ...(authToken === undefined ? {} : { authToken }) });
try {
  const report = await compatibilityReport({
    ...(db === undefined ? {} : { db }),
    environment,
    source: source as "live" | "fixture",
    ...(values.revision === undefined ? {} : { sourceRevision: values.revision }),
    now: Date.now(),
    installedClient,
  });
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = { compatible: 0, incompatible: 1, "insufficient-evidence": 2 }[report.result];
} finally {
  db?.close();
}
