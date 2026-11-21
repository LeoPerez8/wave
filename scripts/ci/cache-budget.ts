// The Actions cache's budget per app (docs/spec.md, Build and CI › Caches). Every entry CI writes
// starts with its app, `mobile-`, `desktop-` or `shared-`, except the phone's kept APKs, whose key
// is the runtime version (`apk-v2-…`, scripts/ci/repack.ts). An entry's family is its key without
// the trailing hashes (its inputs', a commit's), and the newest entry of a family supersedes the
// older ones on the same ref. The caches CI wrote before these rules go too.
//   node scripts/ci/cache-budget.ts prune    delete superseded entries, then report each app's usage
//   node scripts/ci/cache-budget.ts report   only report
import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** A cache entry as GitHub's cache listing has it. */
export type CacheEntry = {
  id: number;
  key: string;
  ref: string;
  version: string;
  size_in_bytes: number;
  created_at: string;
};

export type App = "mobile" | "desktop" | "shared";
export type Usage = Record<App | "other", number>;

const GB = 1024 ** 3;
/** Each app's share of the repository's 10 GB, with room left for a run's new entries. */
export const BUDGET_BYTES: Record<App, number> = {
  mobile: 6 * GB,
  desktop: 2 * GB,
  shared: 1.5 * GB,
};
const TOTAL_BYTES = 9.5 * GB;

/** Caches CI wrote before #1341 (setup-gradle's, setup-node's, and the old ccache and Metro). */
const RETIRED = /^(?:gradle-|ccache-android-|metro-|node-cache-)/;

export const appOf = (key: string): App | undefined =>
  key.startsWith("apk-v2-")
    ? "mobile"
    : (/^(mobile|desktop|shared)-/.exec(key)?.[1] as App | undefined);

export const familyOf = (key: string): string => key.replace(/(?:-[0-9a-f]{32,})+$/, "");

const newer = (a: CacheEntry, b: CacheEntry) =>
  a.created_at === b.created_at ? a.id > b.id : a.created_at > b.created_at;

/**
 * The entries to delete: every retired one, and in each family the older entries of the same
 * ref and version. The version is GitHub's hash of the cached paths, so an entry another
 * system or path list needs is never taken for an older one. Keys CI doesn't write stay.
 */
export function superseded(entries: CacheEntry[]): CacheEntry[] {
  const newest = new Map<string, CacheEntry>();
  const gone: CacheEntry[] = [];
  for (const entry of entries) {
    if (RETIRED.test(entry.key)) {
      gone.push(entry);
      continue;
    }
    if (!appOf(entry.key)) continue;
    const group = [entry.ref, familyOf(entry.key), entry.version].join("\n");
    const kept = newest.get(group);
    if (!kept) newest.set(group, entry);
    else if (newer(entry, kept)) {
      gone.push(kept);
      newest.set(group, entry);
    } else gone.push(entry);
  }
  return gone;
}

export function usage(entries: CacheEntry[]): Usage {
  const total: Usage = { mobile: 0, desktop: 0, shared: 0, other: 0 };
  for (const entry of entries) total[appOf(entry.key) ?? "other"] += entry.size_in_bytes;
  return total;
}

const gb = (bytes: number) => `${(bytes / GB).toFixed(2)} GB`;

export function budgetWarnings(total: Usage): string[] {
  const warnings = (Object.keys(BUDGET_BYTES) as App[])
    .filter((app) => total[app] > BUDGET_BYTES[app])
    .map((app) => `The ${app} caches hold ${gb(total[app])}, over their ${gb(BUDGET_BYTES[app])}.`);
  const sum = Object.values(total).reduce((a, b) => a + b, 0);
  if (sum > TOTAL_BYTES)
    warnings.push(`The Actions cache holds ${gb(sum)}, over 9.5 GB of the repository's 10 GB.`);
  return warnings;
}

const gh = (args: string[]) =>
  execFileSync("gh", ["api", ...args], { encoding: "utf8", timeout: 60000 });

const list = (repository: string): CacheEntry[] =>
  gh(["--paginate", `repos/${repository}/actions/caches?per_page=100`, "--jq", ".actions_caches[]"])
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as CacheEntry);

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const mode = process.argv[2];
  const repository = process.env.GITHUB_REPOSITORY ?? "";
  if ((mode !== "prune" && mode !== "report") || !/^[\w.-]+\/[\w.-]+$/.test(repository)) {
    console.error("usage: GITHUB_REPOSITORY=<owner/repo> cache-budget.ts prune|report");
    process.exit(2);
  }
  let entries = list(repository);
  if (mode === "prune") {
    const gone = new Set<number>();
    for (const entry of superseded(entries)) {
      try {
        gh(["--method", "DELETE", `repos/${repository}/actions/caches/${entry.id}`]);
        gone.add(entry.id);
        console.log(`Deleted ${entry.key} (${entry.ref}, ${gb(entry.size_in_bytes)})`);
      } catch (cause) {
        // Evicted or deleted meanwhile; the next push tries again.
        console.log(`::warning::Couldn't delete ${entry.key}: ${String(cause).split("\n")[0]}`);
      }
    }
    entries = entries.filter((entry) => !gone.has(entry.id));
  }
  const total = usage(entries);
  const lines = [
    "#### Actions cache",
    "",
    "| App | Usage | Budget |",
    "| --- | --- | --- |",
    ...(Object.keys(BUDGET_BYTES) as App[]).map(
      (app) => `| ${app} | ${gb(total[app])} | ${gb(BUDGET_BYTES[app])} |`,
    ),
    `| other | ${gb(total.other)} | |`,
    "",
  ];
  console.log(lines.join("\n"));
  if (process.env.GITHUB_STEP_SUMMARY)
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${lines.join("\n")}\n`);
  for (const warning of budgetWarnings(total)) console.log(`::warning::${warning}`);
}
