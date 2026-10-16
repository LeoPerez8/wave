// The version a push to main releases, if any (docs/spec.md, Releases).
//   node scripts/ci/next-version.ts <package.json version> <tags file>
//     [<changed paths file> [<commits file> <merged PRs file>]]
// bump-version.sh lists the repo's tags (one per line) and the paths changed since the
// channel's previous tag; with no previous tag it passes no paths file and everything counts.
// With a previous tag it also passes the commits since it (one per line) and the PRs merged
// meanwhile (one MergedPr JSON per line, from merged-prs.sh), which decide the bump's size.
// Prints `version=<version>` for $GITHUB_OUTPUT, empty when nothing is released, and why on
// stderr.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

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

/** What a push releases: `version` is unset when it releases nothing. `reason` is for the log. */
export type NextVersion = { version?: string; reason: string };

/**
 * How big a tag bump is: minor when a PR counted since the channel's previous tag (as its
 * patch notes count them) comes from a `feat/` branch, named for the log. Patch otherwise.
 */
export type Bump =
  | { size: "patch" }
  | { size: "minor"; pr: { readonly number: number; readonly branch: string } };

/** The bump the PRs merged in a release's commits make, counted as its patch notes list them. */
export const bumpFor = (release: Pick<PatchNotesInput, "commits" | "pullRequests">): Bump => {
  const feature = listedPullRequests(release).find((pr) => pr.branch.startsWith("feat/"));
  return feature
    ? { size: "minor", pr: { number: feature.number, branch: feature.branch } }
    : { size: "patch" };
};

/** What the next-version rule reads about a push. The ti channel joins it. */
export type NextVersionInput = {
  /** The version in apps/mobile/package.json. */
  version: string;
  /** The repo's tag names. Only `v<version>` ones count, a `-ti` one by its base. */
  tags: readonly string[];
  /** The paths changed since the channel's previous tag, or null when there's none yet. */
  changed: readonly string[] | null;
  /** How big a bump of the highest tag is. Patch when unset. */
  bump?: Bump;
};

/**
 * A push releases when users can see what changed since the previous release (by the change
 * rule, `reachesUsers`). Its version bumps the highest version on any tag by `bump`, unless
 * package.json already holds a higher one (a hand-made bump), which is released as it is.
 */
export const nextVersion = (push: NextVersionInput): NextVersion => {
  if (push.changed?.length === 0)
    return { reason: "Nothing changed since the previous release, so nothing is released." };
  if (push.changed && !reachesUsers(push.changed))
    return {
      reason:
        "Only CI, docs or specs changed since the previous release, so nothing is bumped or released.",
    };
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
      version: format(current),
      reason: `No version is tagged yet: this run releases ${format(current)} from package.json.`,
    };
  if (compare(current, highest.version) > 0)
    return {
      version: format(current),
      reason: `${push.version} in package.json is above every tag (the highest is ${highest.tag}): this run releases it as it is.`,
    };
  const [major, minor, patch] = highest.version;
  if (push.bump?.size === "minor") {
    const { pr } = push.bump;
    const next = format([major, minor + 1, 0]);
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
  const next = format([major, minor, patch + 1]);
  if (patch + 1 >= 100)
    throw new Error(
      `The next version would be ${next}, but minor and patch must stay under 100 for Android's versionCode. ` +
        "Bump the minor or major version in apps/mobile/package.json by hand.",
    );
  return {
    version: next,
    reason: `${highest.tag} is the highest version tagged: this run releases ${next}, a patch bump: no PR since the previous release is from a feat/ branch.`,
  };
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [version = "", tagsFile = "", changedFile, commitsFile, prsFile] = process.argv.slice(2);
  const lines = (path: string) => readFileSync(path, "utf8").split(/\r?\n/).filter(Boolean);
  const decision = nextVersion({
    version,
    tags: lines(tagsFile),
    changed: changedFile === undefined ? null : lines(changedFile),
    ...(commitsFile !== undefined &&
      prsFile !== undefined && {
        bump: bumpFor({
          commits: lines(commitsFile),
          pullRequests: lines(prsFile).map(parseMergedPr),
        }),
      }),
  });
  console.error(decision.reason);
  console.log(`version=${decision.version ?? ""}`);
}
