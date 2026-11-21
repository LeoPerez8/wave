// What a promotion publishes to the main channel (docs/spec.md, Releases): a -ti release under
// the same number without the suffix, each app from its own newest release at or below it.
//   node scripts/ci/promote-version.ts <tags file> [<version> [<releases file> <app> <on|off>]]
// Takes the repo's tags (one per line) and the version asked for, by default the newest -ti
// release. Prints `from=v<x.y.z>-ti` and `to=v<x.y.z>` for $GITHUB_OUTPUT, or fails saying why.
// Given the GitHub Releases (one JSON object per line, changes.ts's PublishedRelease), the app
// asked for (both, mobile or desktop) and RELEASE_DESKTOP_MAIN, it also prints `mobile=<ti tag>`
// and `desktop=<ti tag>` for each app it promotes, and says on stderr why it leaves one out.
//   node scripts/ci/promote-version.ts --check-source <stable tag> <ti tag>
// Fails unless a stable release may be built from that ti release (promotableSource).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import type { PublishedRelease } from "./changes.ts";

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
        `that CI run's failed jobs, or start it if it has none, with the inputs its promotion ` +
        `logged: gh workflow run ci.yml --ref ${to} -f app=<app> -f promoted_from=<ti tag>`,
    );
  const stable = newest(false);
  if (stable && compare(base, stable) < 0)
    throw new Error(
      `v${stable} is already out and ${to} is below it, so phones wouldn't install it. ` +
        'To undo a bad update, use the "Roll back an update" workflow.',
    );
  return { from, to };
};

export type PromotedApp = "mobile" | "desktop";

const STABLE_TAG = /^v(\d+\.\d+\.\d+)$/;
const TI_TAG = /^v(\d+\.\d+\.\d+)-ti$/;

/** The files that show an app published in a release, all of which it must hold. */
const ownFiles = (app: PromotedApp, version: string) =>
  app === "mobile"
    ? [`wave-${version}.apk`, `wave-${version}.provenance.json`]
    : [`wave-${version}-win-x64.exe`, `wave-${version}-linux-x64.AppImage`];

const holds = (app: PromotedApp, { tagName, assets }: PublishedRelease) =>
  ownFiles(app, tagName.slice(1)).every((name) => assets.includes(name));

const NAMES: Record<PromotedApp, string> = { mobile: "phone", desktop: "desktop" };

/**
 * The ti release each app is promoted from when `to` goes out (docs/spec.md, Promotion): its
 * newest -ti release at or below `to`-ti that holds its files, the APK and its record for the
 * phone, both installers for the desktop. An app is left out, with the reason in `skipped`, when
 * it wasn't asked for, has no such release, already went out in a stable release at or above that
 * one, or is the desktop while RELEASE_DESKTOP_MAIN is off. Throws when the one app asked for is
 * left out, or both are.
 */
export const promotedApps = (input: {
  /** The stable tag, v<x.y.z>. */
  to: string;
  app: "both" | PromotedApp;
  releases: readonly PublishedRelease[];
  desktopMain: boolean;
}): { sources: Partial<Record<PromotedApp, string>>; skipped: string[] } => {
  const { to, app, releases } = input;
  if (app !== "both" && app !== "mobile" && app !== "desktop")
    throw new Error(`The app to promote is both, mobile or desktop, not "${String(app)}".`);
  const top = STABLE_TAG.exec(to)?.[1];
  if (!top) throw new Error(`"${to}" isn't a stable tag.`);
  const numbered = releases.flatMap((release) => {
    const ti = TI_TAG.exec(release.tagName)?.[1];
    const base = ti ?? STABLE_TAG.exec(release.tagName)?.[1];
    return base ? [{ release, base, ti: ti !== undefined }] : [];
  });
  const newest = (each: PromotedApp, ti: boolean) =>
    numbered
      .filter(
        (entry) => entry.ti === ti && compare(entry.base, top) <= 0 && holds(each, entry.release),
      )
      .toSorted((a, b) => compare(a.base, b.base))
      .at(-1);

  const sources: Partial<Record<PromotedApp, string>> = {};
  const skipped: string[] = [];
  const asked: readonly PromotedApp[] = app === "both" ? ["mobile", "desktop"] : [app];
  for (const each of asked) {
    const name = NAMES[each];
    const source = newest(each, true);
    const stable = newest(each, false);
    const reason =
      each === "desktop" && !input.desktopMain
        ? "The desktop isn't released to main while RELEASE_DESKTOP_MAIN is off."
        : !source
          ? `The ${name} has no -ti release at or below ${to}-ti with its files.`
          : stable && compare(stable.base, source.base) >= 0
            ? `v${stable.base} already has the ${name} of ${source.release.tagName}, its newest ` +
              `release at or below ${to}-ti.`
            : undefined;
    if (reason === undefined && source) sources[each] = source.release.tagName;
    else if (app === each) throw new Error(`${reason} Nothing to promote.`);
    else skipped.push(`${reason} ${to} goes out without it.`);
  }
  if (!sources.mobile && !sources.desktop)
    throw new Error(`${skipped.join(" ")} Nothing to promote.`);
  return { sources, skipped };
};

/**
 * Why a stable release can't be built from a ti release, or undefined when it can: the ti
 * release must be at or below the stable number, as promotedApps picks it.
 */
export const promotableSource = (stable: string, ti: string): string | undefined => {
  const top = STABLE_TAG.exec(stable)?.[1];
  if (!top) return `${stable} isn't a stable tag.`;
  const base = TI_TAG.exec(ti)?.[1];
  if (!base) return `${ti} isn't a -ti release.`;
  if (compare(base, top) > 0) return `${ti} is above ${stable}, so it can't be promoted to it.`;
  return undefined;
};

const lines = (path: string) => readFileSync(path, "utf8").split(/\r?\n/).filter(Boolean);

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  try {
    if (args[0] === "--check-source") {
      const problem = promotableSource(args[1] ?? "", args[2] ?? "");
      if (problem) throw new Error(problem);
    } else {
      const [tagsFile = "", requested = "", releasesFile, app = "both", desktopMain] = args;
      const { from, to } = promotion({ requested, tags: lines(tagsFile) });
      const out = [`from=${from}`, `to=${to}`];
      if (releasesFile) {
        const releases = lines(releasesFile).map((line) => JSON.parse(line) as PublishedRelease);
        const { sources, skipped } = promotedApps({
          to,
          app: app as PromotedApp,
          releases,
          desktopMain: desktopMain === "on",
        });
        for (const reason of skipped) console.error(reason);
        for (const each of ["mobile", "desktop"] as const)
          if (sources[each]) out.push(`${each}=${sources[each]}`);
      }
      console.log(out.join("\n"));
    }
  } catch (cause) {
    console.error(`::error::${cause instanceof Error ? cause.message : String(cause)}`);
    process.exit(1);
  }
}
