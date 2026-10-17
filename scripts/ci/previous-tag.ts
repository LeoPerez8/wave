// The previous release of a channel before a commit: the tag its changes, patch notes and
// version bump count from (docs/spec.md, Releases and Patch notes). previous-tag.sh lists
// the tags in the commit's history and the ones on the commit itself:
//   <tags in its history> | node scripts/ci/previous-tag.ts main|ti [<its own tag>...]
// Prints the tag, or nothing when the channel has no previous release.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const RELEASE = /^v(\d+)\.(\d+)\.(\d+)(-ti)?$/;

type Release = { tag: string; numbers: readonly [number, number, number]; ti: boolean };

const parse = (tag: string): Release | undefined => {
  const parts = RELEASE.exec(tag);
  if (!parts) return undefined;
  const numbers = [Number(parts[1]), Number(parts[2]), Number(parts[3])] as const;
  return { tag, numbers, ti: parts[4] !== undefined };
};

const newer = (a: Release, b: Release) =>
  a.numbers[0] - b.numbers[0] || a.numbers[1] - b.numbers[1] || a.numbers[2] - b.numbers[2];

/**
 * A channel's previous release before a commit: main's is the newest stable `v<version>` tag
 * in its history; ti's the newest `-ti` one, or the newest stable one before ti's first. The
 * commit's own tags don't count: they're the release it is, not the one before.
 */
export const previousTag = (commit: {
  channel: "main" | "ti";
  /** The tags in the commit's history, its own included. */
  tags: readonly string[];
  /** The tags on the commit itself. */
  own: readonly string[];
}): string | undefined => {
  const own = new Set(commit.own);
  const releases = commit.tags
    .filter((tag) => !own.has(tag))
    .flatMap((tag) => parse(tag) ?? [])
    .toSorted((a, b) => newer(b, a));
  const newest = (ti: boolean) => releases.find((release) => release.ti === ti)?.tag;
  return (commit.channel === "ti" ? newest(true) : undefined) ?? newest(false);
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [channel, ...own] = process.argv.slice(2);
  if (channel !== "main" && channel !== "ti")
    throw new Error(`Expected the channel, main or ti, not "${channel}".`);
  const tags = readFileSync(0, "utf8").split(/\r?\n/).filter(Boolean);
  const tag = previousTag({ channel, tags, own });
  if (tag) console.log(tag);
}
