// What a promotion publishes to the main channel (docs/spec.md, Releases): a -ti release under
// the same number without the suffix, from the same commit.
//   node scripts/ci/promote-version.ts <tags file> [<version>]
// Takes the repo's tags (one per line) and the version asked for, by default the newest -ti
// release. Prints `from=v<x.y.z>-ti` and `to=v<x.y.z>` for $GITHUB_OUTPUT, or fails saying why.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const RELEASE = /^v?(\d+\.\d+\.\d+)(-ti)?$/;

const numbers = (version: string) => version.split(".").map(Number);

const compare = (a: string, b: string) => {
  const [x, y] = [numbers(a), numbers(b)];
  return (x[0] ?? 0) - (y[0] ?? 0) || (x[1] ?? 0) - (y[1] ?? 0) || (x[2] ?? 0) - (y[2] ?? 0);
};

/** The tags a promotion goes between. Throws why when it can't happen. */
export const promotion = (input: {
  /** The version asked for, with or without `v` and `-ti`, or empty for the newest -ti one. */
  requested: string;
  tags: readonly string[];
}): { from: string; to: string } => {
  const releases = input.tags.flatMap((tag) => {
    const parts = tag.startsWith("v") ? RELEASE.exec(tag) : null;
    return parts?.[1] ? [{ base: parts[1], ti: parts[2] !== undefined }] : [];
  });
  const newest = (ti: boolean) =>
    releases
      .filter((release) => release.ti === ti)
      .map((release) => release.base)
      .toSorted(compare)
      .at(-1);

  const requested = input.requested.trim();
  const parts = RELEASE.exec(requested);
  if (requested !== "" && !parts?.[1]) throw new Error(`"${requested}" isn't a version.`);
  const base = parts?.[1] ?? newest(true);
  if (!base) throw new Error("No -ti release exists to promote.");

  const [from, to] = [`v${base}-ti`, `v${base}`];
  if (!input.tags.includes(from))
    throw new Error(`${from} doesn't exist, so it can't be promoted.`);
  if (input.tags.includes(to))
    throw new Error(
      `${to} already exists, so ${from} is already promoted. If its publishing failed, re-run ` +
        "that CI run's failed jobs.",
    );
  const stable = newest(false);
  if (stable && compare(base, stable) < 0)
    throw new Error(
      `v${stable} is already out and ${to} is below it, so phones wouldn't install it. ` +
        'To undo a bad update, use the "Roll back an update" workflow.',
    );
  return { from, to };
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [tagsFile = "", requested = ""] = process.argv.slice(2);
  try {
    const tags = readFileSync(tagsFile, "utf8").split(/\r?\n/).filter(Boolean);
    const { from, to } = promotion({ requested, tags });
    console.log(`from=${from}\nto=${to}`);
  } catch (cause) {
    console.error(`::error::${cause instanceof Error ? cause.message : String(cause)}`);
    process.exit(1);
  }
}
