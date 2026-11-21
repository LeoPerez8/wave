// Which parts of the repo a change touches, and whether it can change the result of the
// native modules' JVM tests.
// The CI workflow runs it (changes.sh) and turns jobs off by it:
//   <paths, one per line> | node scripts/ci/changes.ts   # a PR's files, or one app's since its release
//     [--app-package <before> <after>]                   # the phone's package.json then and now
//     [--merged <git log file>]                          # each change merged since that release
//   node scripts/ci/changes.ts --all                      # every area changed
//   <releases, one JSON line each> | node scripts/ci/changes.ts --previous-release <phone|desktop> <ti|main> [<run's tag>]
// It prints `<area>=true|false` lines, the decisions `allPackages`, `nativeTests` and
// `desktopChecks`, then whether each app releases (`phoneRelease`, `desktopRelease`), ready for
// $GITHUB_OUTPUT. --previous-release prints the tag the app's changes count from, or nothing.
// Checks also runs it, through affected-packages.sh.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";

// Areas of the repo that CI decisions depend on. A path ending in "/" covers
// everything under it; any other path is one file. Markdown is never in an area.
const AREAS = {
  // The APK, with the Kotlin it shares with the desktop (#1144), less DESKTOP_ONLY.
  app: ["apps/mobile/", "packages/client/", "packages/kotlin-shared/"],
  core: ["packages/core/"],
  // The Wave account's sync service. Not in the APK, but users see what it does.
  sync: ["apps/sync/"],
  // The update service. It delivers releases and isn't one: a change to it doesn't release.
  updates: ["apps/updates/"],
  workspace: ["package.json", "pnpm-workspace.yaml", "pnpm-lock.yaml"],
  ci: [".github/", "scripts/ci/"],
  // The release performance runner (docs/performance/README.md). Not in the APK; its
  // tests and typecheck are the root scripts', so a change to it checks everything.
  perf: ["scripts/perf/"],
  // TypeScript config the packages extend.
  tsconfig: ["tsconfig.base.json"],
  // The native modules with JVM tests and what decides how prebuild generates the
  // project they build in. The shared Kotlin's build tests the desktop's entry point too.
  native: [
    "apps/mobile/modules/wave-native/",
    "apps/mobile/modules/wave-glass/",
    "packages/kotlin-shared/",
    "apps/mobile/app.config.ts",
    "apps/mobile/plugins/",
    "apps/mobile/package.json",
  ],
  // What the desktop app is built from, with the Kotlin its JVM runs (#1147).
  desktop: [
    "apps/desktop/",
    "packages/client/",
    "packages/core/",
    "packages/theme/",
    "packages/kotlin-shared/",
  ],
} as const;

type Area = keyof typeof AREAS;

// What only the desktop app is built from, inside or beside an area the phone shares.
const DESKTOP_ONLY = ["apps/desktop/", "packages/kotlin-shared/stdio/"];

// A change to these areas can break any package, so Checks then typechecks and tests
// all of them. Otherwise it checks only the packages a PR changed and their dependents.
const ALL_PACKAGES_AREAS: readonly Area[] = ["workspace", "ci", "tsconfig", "perf"];

// The native modules' JVM tests can only change result when one of these does.
const NATIVE_TEST_AREAS: readonly Area[] = ["native", "workspace", "ci"];

// The desktop's own checks on Windows and Linux (the Desktop job) can only change result
// when one of these does.
const DESKTOP_CHECK_AREAS: readonly Area[] = ["desktop", "workspace", "ci", "tsconfig"];

export type Changes = Record<Area | "allPackages" | "nativeTests" | "desktopChecks", boolean>;

const covers = (entry: string, path: string) =>
  entry.endsWith("/") ? path.startsWith(entry) : path === entry;

const decide = (touched: (area: Area) => boolean): Changes => {
  const areas = Object.fromEntries(
    (Object.keys(AREAS) as Area[]).map((area) => [area, touched(area)]),
  ) as Record<Area, boolean>;
  return {
    ...areas,
    allPackages: ALL_PACKAGES_AREAS.some((area) => areas[area]),
    nativeTests: NATIVE_TEST_AREAS.some((area) => areas[area]),
    desktopChecks: DESKTOP_CHECK_AREAS.some((area) => areas[area]),
  };
};

export const changes = (paths: readonly string[]): Changes =>
  decide((area) =>
    paths.some(
      (path) =>
        !path.endsWith(".md") &&
        AREAS[area].some((entry) => covers(entry, path)) &&
        !(area === "app" && DESKTOP_ONLY.some((entry) => covers(entry, path))),
    ),
  );

/**
 * Whether users can see a change: it changes the APK or the sync service. One that changes
 * only CI, docs or specs (or other tooling) isn't in the patch notes and doesn't release.
 */
export const reachesUsers = (paths: readonly string[]): boolean => {
  const touched = changes(paths);
  return touched.app || touched.core || touched.sync || touched.workspace;
};

export const reachesDesktop = (paths: readonly string[]): boolean => {
  const touched = changes(paths);
  return touched.desktop || touched.sync || touched.workspace;
};

// What only the desktop is made of, by prefix: its app, its JVM's entry point and its own UI text.
const DESKTOP_PREFIXES = [...DESKTOP_ONLY, "packages/core/src/catalogue/desktop"];

const isDesktopOnly = (path: string) => DESKTOP_PREFIXES.some((prefix) => path.startsWith(prefix));

/**
 * Whether the phone's users can see a change (`reachesUsers`), leaving out what only the desktop
 * is made of. A change that also touches the APK, Core or the sync service is the phone's too,
 * whatever it changes in the desktop; one that is otherwise only the desktop's isn't, with the
 * lockfile and workspace files it changes along the way.
 */
export const reachesPhone = (paths: readonly string[]): boolean => {
  const phone = paths.filter((path) => !isDesktopOnly(path));
  if (phone.length === paths.length) return reachesUsers(paths);
  const touched = changes(phone);
  return touched.app || touched.core || touched.sync;
};

/** The phone's package.json, whose `version` every release's bump commit changes. */
export const APP_PACKAGE = "apps/mobile/package.json";

/** apps/mobile/package.json's text before a change (empty when it had none) and after. */
export type AppPackage = { previous: string; current: string };

/** Whether package.json's text changed only its `version`, as a release's bump commit does. */
export const versionOnly = ({ previous, current }: AppPackage): boolean => {
  try {
    const [before, after] = [previous, current].map((text) => {
      const { version: _version, ...rest } = JSON.parse(text) as Record<string, unknown>;
      return rest;
    });
    return isDeepStrictEqual(before, after);
  } catch {
    return false;
  }
};

/**
 * Which app a set of changes releases. On main and tags each app's workflow runs only when its
 * own changes since its previous release (previousAppRelease) reach its users. Given the app's
 * package.json before and after, a change of its version alone doesn't count: a version the
 * desktop released alone bumped it, and the phone has nothing new.
 *
 * `merged` lists the files of each change merged since then (a PR, or a commit pushed to main),
 * when there are several. `reachesPhone` leaves out the workspace files a desktop-only change
 * changed along the way, so it decides per change: the workspace files still count for the phone
 * when a change that touched them reaches it. Without `merged`, the paths are one change.
 */
export const releaseChanges = (
  paths: readonly string[],
  appPackage?: AppPackage,
  merged?: readonly (readonly string[])[],
) => {
  const counted =
    appPackage && versionOnly(appPackage) ? paths.filter((path) => path !== APP_PACKAGE) : paths;
  const workspaceForPhone =
    merged !== undefined &&
    changes(counted).workspace &&
    merged.some((change) => changes(change).workspace && reachesPhone(change));
  return {
    phoneRelease: reachesPhone(counted) || workspaceForPhone,
    desktopRelease: reachesDesktop(counted),
  };
};

/**
 * Each change in `git log --name-only --format='commit %H'` output, as its files. A merge
 * commit's are its diff against main before it (--diff-merges=first-parent).
 */
export const mergedChanges = (log: string): string[][] => {
  const merged: string[][] = [];
  for (const line of log.split(/\r?\n/)) {
    if (line.startsWith("commit ")) merged.push([]);
    else if (line && merged.length > 0) merged.at(-1)!.push(line);
  }
  return merged;
};

/** A GitHub Release, by its tag and the names of the files it holds. */
export type PublishedRelease = { tagName: string; assets: readonly string[] };

export type App = "phone" | "desktop";

const VERSION_TAG = /^v(\d+)\.(\d+)\.(\d+)(-ti)?$/;

/** Whether an app published in a release: its APK, or either desktop installer, is there. */
export const publishedIn = (app: App, { tagName, assets }: PublishedRelease) => {
  const version = tagName.slice(1);
  const own =
    app === "phone"
      ? [`wave-${version}.apk`]
      : [`wave-${version}-win-x64.exe`, `wave-${version}-linux-x64.AppImage`];
  return own.some((name) => assets.includes(name));
};

/**
 * The tag an app's changes count from: its newest release that published its own files. A
 * version that never published (a skipped one, or the other app's alone) doesn't count. The ti
 * channel looks back past stable releases too, which carry a ti release's source; main looks only
 * at stable ones. The run's own tag is left out. Undefined when the app never published.
 */
export const previousAppRelease = (
  releases: readonly PublishedRelease[],
  app: App,
  channel: "ti" | "main",
  current = "",
): string | undefined => {
  const candidates = releases.flatMap((release) => {
    const match = VERSION_TAG.exec(release.tagName);
    if (!match || release.tagName === current || !publishedIn(app, release)) return [];
    const ti = match[4] !== undefined;
    if (ti && channel === "main") return [];
    return [{ tag: release.tagName, ti, numbers: [match[1], match[2], match[3]].map(Number) }];
  });
  const newer = (left: (typeof candidates)[number], right: (typeof candidates)[number]) =>
    right.numbers[0]! - left.numbers[0]! ||
    right.numbers[1]! - left.numbers[1]! ||
    right.numbers[2]! - left.numbers[2]! ||
    Number(left.ti) - Number(right.ti);
  return candidates.toSorted(newer)[0]?.tag;
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args[0] === "--previous-release") {
    const [, app, channel, current] = args;
    if ((app !== "phone" && app !== "desktop") || (channel !== "ti" && channel !== "main"))
      throw new Error("Expected --previous-release phone|desktop ti|main [<tag>]");
    const releases = readFileSync(0, "utf8")
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => JSON.parse(line) as PublishedRelease);
    const tag = previousAppRelease(releases, app, channel, current);
    if (tag) console.log(tag);
  } else {
    const all = args.includes("--all");
    const paths = all ? [] : readFileSync(0, "utf8").split(/\r?\n/).filter(Boolean);
    const packageAt = args.indexOf("--app-package");
    const [previous, current] = packageAt === -1 ? [] : args.slice(packageAt + 1, packageAt + 3);
    if (packageAt !== -1 && current === undefined)
      throw new Error("Expected --app-package <file before> <file after>");
    const appPackage =
      previous === undefined || current === undefined
        ? undefined
        : { previous: readFileSync(previous, "utf8"), current: readFileSync(current, "utf8") };
    const mergedAt = args.indexOf("--merged");
    const log = mergedAt === -1 ? undefined : args[mergedAt + 1];
    if (mergedAt !== -1 && log === undefined) throw new Error("Expected --merged <git log file>");
    const merged = log === undefined ? undefined : mergedChanges(readFileSync(log, "utf8"));
    const result = all
      ? { ...decide(() => true), phoneRelease: true, desktopRelease: true }
      : { ...changes(paths), ...releaseChanges(paths, appPackage, merged) };
    for (const [name, value] of Object.entries(result)) console.log(`${name}=${value}`);
  }
}
