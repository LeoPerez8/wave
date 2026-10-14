// Which parts of the repo a change touches, and whether it can change the APK.
// The CI workflow runs it on a PR's changed files and turns jobs off by it:
//   <paths, one per line> | node scripts/ci/changes.ts   # PRs
//   node scripts/ci/changes.ts --all                      # everything else
// It prints `<area>=true|false` lines and `apk=true|false`, ready for $GITHUB_OUTPUT.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Areas of the repo that CI decisions depend on. A path ending in "/" covers
// everything under it; any other path is one file. Markdown is never in an area.
const AREAS = {
  app: ["apps/mobile/"],
  core: ["packages/core/"],
  workspace: ["package.json", "pnpm-workspace.yaml", "pnpm-lock.yaml"],
  ci: [".github/", "scripts/ci/"],
} as const;

type Area = keyof typeof AREAS;

// The APK is built from these areas: a change outside them can't alter it.
const APK_AREAS: readonly Area[] = ["app", "core", "workspace", "ci"];

export type Changes = Record<Area | "apk", boolean>;

const covers = (entry: string, path: string) =>
  entry.endsWith("/") ? path.startsWith(entry) : path === entry;

const decide = (touched: (area: Area) => boolean): Changes => {
  const areas = Object.fromEntries(
    (Object.keys(AREAS) as Area[]).map((area) => [area, touched(area)]),
  ) as Record<Area, boolean>;
  return { ...areas, apk: APK_AREAS.some((area) => areas[area]) };
};

export const changes = (paths: readonly string[]): Changes =>
  decide((area) =>
    paths.some((path) => !path.endsWith(".md") && AREAS[area].some((entry) => covers(entry, path))),
  );

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = process.argv.includes("--all")
    ? decide(() => true)
    : changes(readFileSync(0, "utf8").split(/\r?\n/).filter(Boolean));
  for (const [name, value] of Object.entries(result)) console.log(`${name}=${value}`);
}
