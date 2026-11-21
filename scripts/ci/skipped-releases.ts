// The versions a release goes out after that never published: tagged by a run whose release
// gate failed, so they have a tag but no GitHub release, notes or update. The release carries
// their notes too, each under its own version (docs/spec.md, Patch notes). earlier-notes.sh
// lists the commit's tags, its own and the tags GitHub has releases on:
//   <tags in its history> | node scripts/ci/skipped-releases.ts main|ti <published file> [<its own tag>...]
// Prints the skipped tags, oldest first, one per line. earlier-notes.sh then gathers their notes:
//   node scripts/ci/skipped-releases.ts --entries [<version> <date> <notes file>]...
// Prints [{ version, date, notes }] as one line of JSON, the date in ISO 8601 UTC.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const RELEASE = /^v(\d+)\.(\d+)\.(\d+)(-ti)?$/;

/** How many of the channel's tags before the commit's are looked at. */
const WITHIN = 20;

type Release = { tag: string; numbers: readonly [number, number, number] };

const parse = (tag: string, ti: boolean): Release | undefined => {
  const parts = RELEASE.exec(tag);
  if (!parts || (parts[4] !== undefined) !== ti) return undefined;
  return { tag, numbers: [Number(parts[1]), Number(parts[2]), Number(parts[3])] };
};

const older = (a: Release, b: Release) =>
  a.numbers[0] - b.numbers[0] || a.numbers[1] - b.numbers[1] || a.numbers[2] - b.numbers[2];

/**
 * The channel's tags in the commit's history, its own left out, that no release was published
 * on, oldest first. Only the channel's `within` newest tags count, so a run asks GitHub about a
 * bounded number of them.
 */
export const skippedReleases = (commit: {
  channel: "main" | "ti";
  /** The tags in the commit's history, its own included. */
  tags: readonly string[];
  /** The tags on the commit itself. */
  own: readonly string[];
  /** The tags GitHub has a release on. */
  published: readonly string[];
  within?: number;
}): string[] => {
  const own = new Set(commit.own);
  const published = new Set(commit.published);
  return commit.tags
    .filter((tag) => !own.has(tag))
    .flatMap((tag) => parse(tag, commit.channel === "ti") ?? [])
    .toSorted(older)
    .slice(-(commit.within ?? WITHIN))
    .filter(({ tag }) => !published.has(tag))
    .map(({ tag }) => tag);
};

/** The earlier releases' notes for publish-notes.ts, from (version, date, notes) triples. */
export const earlierEntries = (
  args: readonly string[],
  read: (file: string) => string,
): { version: string; date: string; notes: unknown }[] => {
  if (args.length % 3 !== 0) throw new Error("Expected a version, a date and a notes file each.");
  return Array.from({ length: args.length / 3 }, (_, i) => {
    const [version = "", date = "", file = ""] = args.slice(i * 3, i * 3 + 3);
    return {
      version,
      date: new Date(date).toISOString(),
      notes: JSON.parse(read(file)) as unknown,
    };
  });
};

if (process.argv[1] === fileURLToPath(import.meta.url) && process.argv[2] === "--entries") {
  const entries = earlierEntries(process.argv.slice(3), (file) => readFileSync(file, "utf8"));
  console.log(JSON.stringify(entries));
} else if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const lines = (text: string) => text.split(/\r?\n/).filter(Boolean);
  const [channel, publishedFile = "", ...own] = process.argv.slice(2);
  if (channel !== "main" && channel !== "ti")
    throw new Error(`Expected the channel, main or ti, not "${channel}".`);
  const tags = lines(readFileSync(0, "utf8"));
  const published = lines(readFileSync(publishedFile, "utf8"));
  for (const tag of skippedReleases({ channel, tags, own, published })) console.log(tag);
}
