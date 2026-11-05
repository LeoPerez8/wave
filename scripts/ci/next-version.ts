// The version a push to main releases, if any (docs/spec.md, Releases).
//   node scripts/ci/next-version.ts [--ti] --package <apps/mobile/package.json> --tags <file>
//     [--own <file>] [--changed <file> --previous-package <file>
//      --commits <file> --unreleased <file> --prs <file>]
// bump-version.sh passes the app's package.json, the repo's tags and the tags on the pushed
// commit (one per line each). With the channel's previous tag (previous-tag.sh) it also
// passes the paths changed since then, the app's package.json as it was then (empty when it
// didn't exist), the commits since then, the commits no v* tag contains (one per line each)
// and the PRs merged meanwhile (one MergedPr JSON per line, from merged-prs.sh), which decide
// the bump's size. Without --changed everything counts as changed.
// Prints `version=<version>` for $GITHUB_OUTPUT, empty when nothing is released, and why on
// stderr.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual, parseArgs } from "node:util";

import { reachesUsers } from "./changes.ts";
import { listedPullRequests, parseMergedPr, type PatchNotesInput } from "./patch-notes.ts";

type Version = readonly [major: number, minor: number, patch: number];

const VERSION = /^(\d+)\.(\d+)\.(\d+)(?:-ti)?$/;

// A version's base: its numbers, without the -ti suffix.
const parse = (version: string): Version | undefined => {
  const parts = VERSION.exec(version);
  if (!parts) return undefined;
  return [Number(parts[1]), Number(parts[2]), Number(parts[3])];
};

const compare = (a: Version, b: Version) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];

const format = ([major, minor, patch]: Version) => `${major}.${minor}.${patch}`;

const APP_PACKAGE = "apps/mobile/package.json";

// Whether package.json's text changed only its `version`, as a release's bump commit does.
const versionOnly = ({ previous, current }: { previous: string; current: string }) => {
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

/** What a push releases: `version` is unset when it releases nothing. `reason` is for the log. */
export type NextVersion = { version?: string; reason: string };

/**
 * How big a tag bump is: minor when a PR counted since the channel's previous tag (as its
 * patch notes count them) that no release has shipped yet comes from a `feat/` branch, named
 * for the log. Patch otherwise.
 */
export type Bump =
  { size: "patch" } | { size: "minor"; pr: { readonly number: number; readonly branch: string } };

/**
 * The bump the PRs merged in a release's commits make, counted as its patch notes list them,
 * less those whose merge commit a `v*` tag of either channel already contains: the shared
 * counter bumped for them then (a feat/ PR already released doesn't bump the minor again).
 */
export const bumpFor = (
  release: Pick<PatchNotesInput, "commits" | "pullRequests"> & {
    /** The commits no `v*` tag contains yet. */
    unreleased: readonly string[];
  },
): Bump => {
  const unreleased = new Set(release.unreleased);
  const feature = listedPullRequests(release).find(
    (pr) => unreleased.has(pr.mergeCommit) && pr.branch.startsWith("feat/"),
  );
  return feature
    ? { size: "minor", pr: { number: feature.number, branch: feature.branch } }
    : { size: "patch" };
};

/** What the next-version rule reads about a push. */
export type NextVersionInput = {
  /** The channel it releases to: ti's versions end in -ti. main when unset. */
  channel?: "main" | "ti";
  /** The version in apps/mobile/package.json. */
  version: string;
  /** The repo's tag names. Only `v<version>` ones count, a `-ti` one by its base. */
  tags: readonly string[];
  /** The tags on the pushed commit itself. */
  own?: readonly string[];
  /** The paths changed since the channel's previous tag, or null when there's none yet. */
  changed: readonly string[] | null;
  /**
   * apps/mobile/package.json's text at the channel's previous tag (empty when it had none)
   * and now, to tell a change of its version alone.
   */
  appPackage?: { previous: string; current: string };
  /** How big a bump of the highest tag is. Patch when unset. */
  bump?: Bump;
};

/**
 * A push releases when users can see what changed since the previous release (by the change
 * rule, `reachesUsers`; a change of the app's package.json version alone doesn't count). Its
 * version bumps the highest version on any tag by `bump`, unless package.json already holds a
 * higher one (a hand-made bump), which is released as it is. Both channels count from the
 * same tags; ti's version gets the -ti suffix. A pushed commit that already carries its
 * channel's tag for package.json's version is released as it is.
 */
export const nextVersion = (push: NextVersionInput): NextVersion => {
  const suffix = push.channel === "ti" ? "-ti" : "";
  // A run whose bump was pushed and tagged but not published (or a re-run of one).
  const tagged = `v${push.version}`;
  if (push.version.endsWith("-ti") === (suffix === "-ti") && push.own?.includes(tagged))
    return {
      version: push.version,
      reason: `The pushed commit is already tagged ${tagged}: this run releases it as it is.`,
    };
  if (push.changed?.length === 0)
    return { reason: "Nothing changed since the previous release, so nothing is released." };
  if (push.changed && !reachesUsers(push.changed))
    return {
      reason:
        "Only CI, docs or specs changed since the previous release, so nothing is bumped or released.",
    };
  if (push.changed && push.appPackage && versionOnly(push.appPackage)) {
    const others = push.changed.filter((path) => path !== APP_PACKAGE);
    if (!reachesUsers(others))
      return {
        reason:
          "Only CI, docs, specs or the app's version changed since the previous release so nothing is bumped or released.",
      };
  }
  const current = parse(push.version);
  if (!current)
    throw new Error(`package.json's version isn't major.minor.patch: "${push.version}"`);
  const highest = push.tags
    .flatMap((tag) => {
      const version = tag.startsWith("v") ? parse(tag.slice(1)) : undefined;
      return version ? [{ tag, version }] : [];
    })
    .toSorted((a, b) => compare(a.version, b.version))
    .at(-1);
  if (!highest)
    return {
      version: format(current) + suffix,
      reason: `No version is tagged yet: this run releases ${format(current) + suffix} from package.json.`,
    };
  if (compare(current, highest.version) > 0)
    return {
      version: format(current) + suffix,
      reason: `${push.version} in package.json is above every tag (the highest is ${highest.tag}): this run releases it as it is.`,
    };
  const [major, minor, patch] = highest.version;
  if (push.bump?.size === "minor") {
    const { pr } = push.bump;
    const next = format([major, minor + 1, 0]) + suffix;
    if (minor + 1 >= 100)
      throw new Error(
        `#${pr.number} (${pr.branch}) makes the next version ${next}, but minor and patch must stay under 100 for Android's versionCode. ` +
          "Bump the major version in apps/mobile/package.json by hand.",
      );
    return {
      version: next,
      reason: `${highest.tag} is the highest version tagged: this run releases ${next}, a minor bump, because #${pr.number} (${pr.branch}) is a feature.`,
    };
  }
  const next = format([major, minor, patch + 1]) + suffix;
  if (patch + 1 >= 100)
    throw new Error(
      `The next version would be ${next}, but minor and patch must stay under 100 for Android's versionCode. ` +
        "Bump the minor or major version in apps/mobile/package.json by hand.",
    );
  return {
    version: next,
    reason: `${highest.tag} is the highest version tagged: this run releases ${next}, a patch bump: no PR since the previous release that no version tag has shipped yet is from a feat/ branch.`,
  };
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({
    options: {
      ti: { type: "boolean", default: false },
      package: { type: "string" },
      tags: { type: "string" },
      own: { type: "string" },
      changed: { type: "string" },
      "previous-package": { type: "string" },
      commits: { type: "string" },
      unreleased: { type: "string" },
      prs: { type: "string" },
    },
  });
  const required = (name: string, value: string | undefined) => {
    if (value === undefined) throw new Error(`next-version.ts needs --${name} <file>.`);
    return value;
  };
  const lines = (path: string) => readFileSync(path, "utf8").split(/\r?\n/).filter(Boolean);
  const appPackage = readFileSync(required("package", values.package), "utf8");
  const { version } = JSON.parse(appPackage) as { version?: unknown };
  if (typeof version !== "string")
    throw new Error(`${values.package} has no string "version" field.`);
  const previousPackage = values["previous-package"];
  const decision = nextVersion({
    channel: values.ti ? "ti" : "main",
    version,
    tags: lines(required("tags", values.tags)),
    own: values.own === undefined ? [] : lines(values.own),
    changed: values.changed === undefined ? null : lines(values.changed),
    ...(previousPackage !== undefined && {
      appPackage: { previous: readFileSync(previousPackage, "utf8"), current: appPackage },
    }),
    ...(values.commits !== undefined &&
      values.prs !== undefined && {
        bump: bumpFor({
          commits: lines(values.commits),
          unreleased: lines(required("unreleased", values.unreleased)),
          pullRequests: lines(values.prs).map(parseMergedPr),
        }),
      }),
  });
  console.error(decision.reason);
  console.log(`version=${decision.version ?? ""}`);
}
