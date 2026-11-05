// A cache entry can be evicted or out of a run's scope. Find a compatible full APK
// uploaded by a successful CI push on main; download-artifact restores it in ci.yml.
//   node scripts/ci/kept-apk.ts <native key>   prints runId=<id>, or an empty runId
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Candidate run ids, newest first, from GitHub's artifact listing. */
export const keptApkRunIds = (value: unknown, key: string): number[] => {
  if (!record(value) || !Array.isArray(value.artifacts))
    throw new Error("Invalid artifact listing: expected an artifacts array.");
  const runs = new Set<number>();
  for (const artifact of value.artifacts) {
    if (!record(artifact) || artifact.name !== `kept-${key}` || artifact.expired !== false)
      continue;
    const run = artifact.workflow_run;
    if (
      !record(run) ||
      run.head_branch !== "main" ||
      typeof run.id !== "number" ||
      !Number.isSafeInteger(run.id) ||
      run.id <= 0 ||
      typeof run.repository_id !== "number" ||
      run.repository_id !== run.head_repository_id
    )
      continue;
    runs.add(run.id);
  }
  return [...runs].toSorted((a, b) => b - a);
};

/** Only this repository's successful CI pushes on main may provide the native APK. */
export const isTrustedMainBuild = (value: unknown, repository: string): boolean =>
  record(value) &&
  value.event === "push" &&
  value.head_branch === "main" &&
  value.path === ".github/workflows/ci.yml" &&
  value.status === "completed" &&
  value.conclusion === "success" &&
  record(value.repository) &&
  typeof value.repository.full_name === "string" &&
  value.repository.full_name.toLowerCase() === repository.toLowerCase();

const api = (path: string): unknown =>
  JSON.parse(execFileSync("gh", ["api", path], { encoding: "utf8", timeout: 30000 }));

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const key = process.argv[2] ?? "";
  const repository = process.env.GITHUB_REPOSITORY ?? "";
  let runId: number | undefined;
  try {
    if (!/^apk-v1-[a-f0-9]{64}$/.test(key) || !/^[\w.-]+\/[\w.-]+$/.test(repository))
      throw new Error("Expected a native APK key and GITHUB_REPOSITORY.");
    const listing = api(`repos/${repository}/actions/artifacts?name=kept-${key}&per_page=100`);
    for (const id of keptApkRunIds(listing, key).slice(0, 5)) {
      if (isTrustedMainBuild(api(`repos/${repository}/actions/runs/${id}`), repository)) {
        runId = id;
        break;
      }
    }
  } catch (cause) {
    // This is a cache: an unavailable API or expired artifact falls back to Gradle.
    console.error(`Could not find a kept APK; using the normal build plan. ${String(cause)}`);
  }
  console.log(`runId=${runId ?? ""}`);
}
