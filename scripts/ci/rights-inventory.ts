// The rights inventory's machine-checked half (docs/licensing/rights-inventory.md): the exact
// npm packages an app ships, read from pnpm-lock.yaml, each one's declared licence and whether
// that licence can be combined with GPL-3.0-only, plus the Gradle libraries and the hand-kept
// components (ported code, assets) the inventory must cover. Anything unknown stays pending and
// keeps the readiness verdict blocked.
//   node scripts/ci/rights-inventory.ts snapshot --node-modules <dir>   (records docs/licensing/npm-packages.json)
//   node scripts/ci/rights-inventory.ts check                           (lists blockers; exit 1 while any)
//   node scripts/ci/rights-inventory.ts notices                         (the notices a release carries, as JSON)

import { createHash } from "node:crypto";
import { existsSync, lstatSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export type Package = { name: string; version: string };

const unquote = (text: string): string => text.trim().replace(/^(["'])(.*)\1$/, "$2");

/** `name@1.2.0(peer@1.0.0)` → name and bare version. */
function splitKey(key: string): Package {
  const bare = key.split("(")[0] ?? key;
  const at = bare.lastIndexOf("@");
  return { name: bare.slice(0, at), version: bare.slice(at + 1) };
}

type Lockfile = {
  /** importer path → its production (and optional) dependencies as `name@version(peers)` or a link. */
  importers: Map<string, { name: string; version: string }[]>;
  /** snapshot key → the keys it depends on. */
  snapshots: Map<string, string[]>;
};

function parseLockfile(text: string): Lockfile {
  const importers: Lockfile["importers"] = new Map();
  const snapshots: Lockfile["snapshots"] = new Map();
  let section = "";
  let owner = "";
  let group = "";
  let dependency = "";
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith("#")) continue;
    const indent = line.length - line.trimStart().length;
    const body = line.trim();
    if (indent === 0) {
      section = body.replace(/:.*$/, "");
      continue;
    }
    if (section === "importers") {
      if (indent === 2) {
        owner = unquote(body.replace(/:$/, ""));
        importers.set(owner, []);
      } else if (indent === 4) group = body.replace(/:$/, "");
      else if (indent === 6) dependency = unquote(body.replace(/:$/, ""));
      else if (indent === 8 && body.startsWith("version:") && group !== "devDependencies")
        importers.get(owner)?.push({ name: dependency, version: unquote(body.slice(8)) });
    } else if (section === "snapshots") {
      if (indent === 2) {
        owner = unquote(body.replace(/:( \{\})?$/, ""));
        snapshots.set(owner, []);
      } else if (indent === 4) group = body.replace(/:$/, "");
      else if (indent === 6 && (group === "dependencies" || group === "optionalDependencies")) {
        const colon = body.indexOf(": ", body.startsWith("'") ? body.indexOf("'", 1) : 0);
        const name = unquote(body.slice(0, colon));
        snapshots.get(owner)?.push(`${name}@${unquote(body.slice(colon + 2))}`);
      }
    }
  }
  return { importers, snapshots };
}

/**
 * The exact packages [importer] ships: its dependencies and optional dependencies, those of the
 * workspace packages it links, and everything they depend on, without any importer's dev tools.
 */
export function distributedPackages(lockfile: string, importer: string): Package[] {
  const { importers, snapshots } = parseLockfile(lockfile);
  const seen = new Set<string>();
  const pending: string[] = [];
  const visitedImporters = new Set<string>();
  const addImporter = (path: string): void => {
    if (visitedImporters.has(path)) return;
    visitedImporters.add(path);
    for (const { name, version } of importers.get(path) ?? []) {
      if (version.startsWith("link:")) addImporter(joinPath(path, version.slice(5)));
      else pending.push(`${name}@${version}`);
    }
  };
  addImporter(importer);
  while (pending.length > 0) {
    const key = pending.pop()!;
    if (seen.has(key)) continue;
    seen.add(key);
    pending.push(...(snapshots.get(key) ?? []));
  }
  const unique = new Map<string, Package>();
  for (const key of seen) {
    const found = splitKey(key);
    unique.set(`${found.name}@${found.version}`, found);
  }
  return [...unique.values()].toSorted((a, b) =>
    a.name === b.name ? a.version.localeCompare(b.version) : a.name < b.name ? -1 : 1,
  );
}

function joinPath(from: string, relative: string): string {
  const parts = from === "." ? [] : from.split("/");
  for (const part of relative.split("/")) {
    if (part === "..") parts.pop();
    else if (part !== "." && part) parts.push(part);
  }
  return parts.join("/") || ".";
}

export type Verdict = "compatible" | "pending";

/**
 * SPDX ids the FSF lists as compatible with GPLv3 (https://www.gnu.org/licenses/license-list.html),
 * so code under them can be conveyed in a GPL-3.0-only work. MPL-2.0 isn't here: it is compatible
 * only when no file says "Incompatible With Secondary Licenses", which a review records per package.
 */
const COMPATIBLE = new Set([
  "0BSD",
  "Apache-2.0",
  "Artistic-2.0",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "BSL-1.0",
  "CC-BY-4.0",
  "CC0-1.0",
  "GPL-2.0-or-later",
  "GPL-2.0+",
  "GPL-3.0",
  "GPL-3.0-only",
  "GPL-3.0-or-later",
  "GPL-3.0+",
  "ISC",
  "LGPL-2.1",
  "LGPL-2.1-only",
  "LGPL-2.1-or-later",
  "LGPL-2.1+",
  "LGPL-3.0",
  "LGPL-3.0-only",
  "LGPL-3.0-or-later",
  "LGPL-3.0+",
  "MIT",
  "MIT-0",
  "Python-2.0",
  "Unlicense",
  "WTFPL",
  "X11",
  "Zlib",
]);

/** Whether code under the SPDX [expression] can be combined with GPL-3.0-only; unknown is pending. */
export function licenceVerdict(expression: string | undefined): Verdict {
  const tokens = (expression ?? "")
    .replace(/([()])/g, " $1 ")
    .split(/\s+/)
    .filter(Boolean);
  if (tokens.length === 0) return "pending";
  let at = 0;
  // OR takes any compatible choice; AND needs every part compatible.
  const either = (): boolean | undefined => {
    let result = both();
    while (tokens[at] === "OR") {
      at++;
      const next = both();
      result = result === undefined || next === undefined ? undefined : result || next;
    }
    return result;
  };
  const both = (): boolean | undefined => {
    let result = single();
    while (tokens[at] === "AND") {
      at++;
      const next = single();
      result = result === undefined || next === undefined ? undefined : result && next;
    }
    return result;
  };
  const single = (): boolean | undefined => {
    const token = tokens[at++];
    if (token === "(") {
      const inner = either();
      return tokens[at++] === ")" ? inner : undefined;
    }
    if (token === undefined || token === ")" || token === "AND" || token === "OR") return undefined;
    if (tokens[at] === "WITH") at += 2; // An exception only adds permissions.
    return COMPATIBLE.has(token);
  };
  const result = either();
  return result === true && at === tokens.length ? "compatible" : "pending";
}

/** A shipped package at an exact version, with the licence its package.json declares. */
export type ShippedPackage = Package & { licence: string | undefined };

/** A recorded check of one exact package version whose declared licence alone is pending. */
export type Review = { package: string; status: Status; evidence: string };

/** Where a component stands: only `compatible` lets readiness pass. */
export type Status = "compatible" | "action-required" | "pending" | "incompatible";

/** Something the inventory keeps by hand: ported code, a native library, an asset. */
export type Component = {
  id: string;
  kind: string;
  status: Status;
  /** Gradle coordinates (`group:artifact:version`) this entry covers. */
  coordinates?: string[];
  /** The licence the component is under, as its own source states it. */
  licence?: string;
  /** What a release must carry for it: the notice to keep, or where it is. */
  notice?: string;
  /** Where its exact source is, for a library whose licence makes it Corresponding Source. */
  correspondingSource?: string;
  /** How a blocker became compatible: observed, an owner statement or exception, or excluded. */
  resolution?: string;
};

/** A notice a release carries: a package's notice files (null when not observed) or a component's. */
export type Notice = { subject: string; licence: string | undefined; notices: string[] | null };

/**
 * The notices a release of these packages and components carries, for the source package: each
 * shipped package once with the notice files it holds, then each component that names a notice.
 */
export function requiredNotices(
  packages: (ShippedPackage & { notices: string[] | null })[],
  components: Component[],
): Notice[] {
  const found = new Map<string, Notice>();
  for (const shipped of packages)
    found.set(`${shipped.name}@${shipped.version}`, {
      subject: `${shipped.name}@${shipped.version}`,
      licence: shipped.licence,
      notices: shipped.notices,
    });
  const bySubject = (a: Notice, b: Notice): number =>
    a.subject < b.subject ? -1 : a.subject > b.subject ? 1 : 0;
  return [
    ...[...found.values()].toSorted(bySubject),
    ...components
      .filter((component) => component.notice !== undefined)
      .map((component) => ({
        subject: component.id,
        licence: component.licence,
        notices: [component.notice!],
      }))
      .toSorted(bySubject),
  ];
}

export type Blocker = { subject: string; reason: string };

export type RightsInput = {
  packages: ShippedPackage[];
  reviews: Review[];
  components: Component[];
  /** Gradle coordinates the release build declares. */
  gradle: string[];
};

/** What still keeps the GPL-3.0-only readiness verdict blocked; ready only when nothing does. */
export function rightsReport(input: RightsInput): { ready: boolean; blockers: Blocker[] } {
  const blockers: Blocker[] = [];
  const reviews = new Map(input.reviews.map((review) => [review.package, review]));
  for (const shipped of input.packages) {
    if (licenceVerdict(shipped.licence) === "compatible") continue;
    const subject = `${shipped.name}@${shipped.version}`;
    const review = reviews.get(subject);
    if (review?.status === "compatible") continue;
    blockers.push({
      subject,
      reason: review
        ? `reviewed as ${review.status}: ${review.evidence}`
        : `declared licence ${shipped.licence ?? "(none)"} is pending review`,
    });
  }
  const covered = new Set<string>();
  for (const component of input.components) {
    for (const coordinate of component.coordinates ?? []) covered.add(coordinate);
    if (component.status !== "compatible")
      blockers.push({ subject: component.id, reason: `${component.kind} is ${component.status}` });
  }
  for (const coordinate of input.gradle)
    if (!covered.has(coordinate))
      blockers.push({ subject: coordinate, reason: "Gradle library missing from the inventory" });
  return { ready: blockers.length === 0, blockers: sortBySubject(blockers) };
}

const sortBySubject = (blockers: Blocker[]): Blocker[] =>
  blockers.toSorted((a, b) => (a.subject < b.subject ? -1 : a.subject > b.subject ? 1 : 0));

const shippedDeclaration =
  /^\s*(?:implementation|api|runtimeOnly)\s*(?:\(\s*)?(?:platform\s*\(\s*)?["']([^"']+)["']/;

/** The `group:artifact[:version]` libraries a build.gradle ships (not its test or build tools). */
export function gradleCoordinates(buildGradle: string): string[] {
  return buildGradle
    .split(/\r?\n/)
    .map((line) => shippedDeclaration.exec(line.replace(/\/\/.*$/, ""))?.[1])
    .filter((coordinate): coordinate is string => coordinate !== undefined)
    .toSorted();
}

export type Installed = { licence: string | undefined; notices: string[] };

const noticeFile = /^(licen[cs]e|notice|copying|authors)(\.|-|_|$)/i;

/**
 * The package a pnpm store entry holds: the one real directory in its `node_modules`, whose
 * siblings are links to its dependencies. The entry's own name can be shortened with a hash.
 */
function ownPackage(inner: string): string | undefined {
  if (!existsSync(inner)) return undefined;
  for (const entry of readdirSync(inner, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const path = join(inner, entry.name);
    if (entry.name.startsWith("@")) {
      for (const scoped of readdirSync(path, { withFileTypes: true }))
        if (!lstatSync(join(path, scoped.name)).isSymbolicLink()) return join(path, scoped.name);
    } else if (!lstatSync(path).isSymbolicLink()) return path;
  }
  return undefined;
}

/**
 * What each package installed in [nodeModules] (a pnpm `node_modules`, read through its `.pnpm`
 * store) declares: its licence, as its package.json gives it, and the notice files it carries.
 * Keyed by `name@version`.
 */
export function installedLicences(nodeModules: string): Record<string, Installed> {
  const store = join(nodeModules, ".pnpm");
  const found: Record<string, Installed> = {};
  for (const entry of readdirSync(store)) {
    const dir = ownPackage(join(store, entry, "node_modules"));
    if (dir === undefined) continue;
    const manifestPath = join(dir, "package.json");
    if (!existsSync(manifestPath)) continue;
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
      name: string;
      version: string;
      license?: string | { type?: string };
      licenses?: { type?: string }[];
    };
    const declared =
      typeof manifest.license === "string"
        ? manifest.license
        : (manifest.license?.type ??
          (manifest.licenses?.length
            ? manifest.licenses.map((licence) => licence.type).join(" OR ")
            : undefined));
    found[`${manifest.name}@${manifest.version}`] = {
      licence: declared,
      notices: readdirSync(dir)
        .filter((file) => noticeFile.test(file))
        .toSorted(),
    };
  }
  return Object.fromEntries(Object.entries(found).toSorted(([a], [b]) => (a < b ? -1 : 1)));
}

// ---- Command line ----------------------------------------------------------------------------

/** The importers whose packages leave the repository: the Android app and the sync Worker. */
const SHIPPED_IMPORTERS = ["apps/mobile", "apps/sync"];
const GRADLE_FILES = [
  "apps/mobile/modules/wave-native/android/build.gradle",
  "apps/mobile/modules/wave-glass/android/build.gradle",
  "packages/kotlin-shared/build.gradle.kts",
];
const SNAPSHOT = "docs/licensing/npm-packages.json";
const COMPONENTS = "docs/licensing/components.json";

type SnapshotEntry = Package & {
  licence: string | undefined;
  /** Notice files in the installed package; null when it wasn't installed on the observing host. */
  notices: string[] | null;
  source: "installed package.json" | "npm registry metadata";
};
type Snapshot = { lockfileSha256: string; importers: Record<string, SnapshotEntry[]> };

async function registryLicence(name: string, version: string): Promise<string | undefined> {
  const url = `https://registry.npmjs.org/${name.replace("/", "%2f")}/${version}`;
  const response = await fetch(url, { headers: { "user-agent": "rights-inventory" } });
  if (!response.ok) throw new Error(`${url} answered ${response.status}`);
  const manifest = (await response.json()) as { license?: string | { type?: string } };
  return typeof manifest.license === "string" ? manifest.license : manifest.license?.type;
}

async function snapshot(nodeModules: string): Promise<void> {
  const lockfile = readFileSync("pnpm-lock.yaml", "utf8");
  const installed = installedLicences(nodeModules);
  const importers: Snapshot["importers"] = {};
  for (const importer of SHIPPED_IMPORTERS) {
    importers[importer] = [];
    for (const shipped of distributedPackages(lockfile, importer)) {
      const found = installed[`${shipped.name}@${shipped.version}`];
      importers[importer].push(
        found
          ? { ...shipped, ...found, source: "installed package.json" }
          : {
              ...shipped,
              licence: await registryLicence(shipped.name, shipped.version),
              notices: null,
              source: "npm registry metadata",
            },
      );
    }
  }
  const lockfileSha256 = createHash("sha256").update(lockfile).digest("hex");
  writeFileSync(SNAPSHOT, `${JSON.stringify({ lockfileSha256, importers }, null, 2)}\n`);
  console.log(`Wrote ${SNAPSHOT}.`);
}

type Recorded = { components: Component[]; reviews: Review[] };

/** The packages the lockfile ships, with what the snapshot recorded for each (nothing when absent). */
function recordedPackages(): (ShippedPackage & { notices: string[] | null })[] {
  const lockfile = readFileSync("pnpm-lock.yaml", "utf8");
  const recorded = JSON.parse(readFileSync(SNAPSHOT, "utf8")) as Snapshot;
  const packages: (ShippedPackage & { notices: string[] | null })[] = [];
  for (const importer of SHIPPED_IMPORTERS) {
    const known = new Map(
      (recorded.importers[importer] ?? []).map((entry) => [
        `${entry.name}@${entry.version}`,
        entry,
      ]),
    );
    for (const shipped of distributedPackages(lockfile, importer)) {
      const entry = known.get(`${shipped.name}@${shipped.version}`);
      if (!entry)
        console.error(`${importer}: ${shipped.name}@${shipped.version} isn't in ${SNAPSHOT}.`);
      packages.push({ ...shipped, licence: entry?.licence, notices: entry?.notices ?? null });
    }
  }
  return packages;
}

/** What keeps this checkout's inventory from passing, read from the repository root. */
export function rightsBlockers(): Blocker[] {
  const { components, reviews } = JSON.parse(readFileSync(COMPONENTS, "utf8")) as Recorded;
  const packages = recordedPackages();
  const gradle = GRADLE_FILES.flatMap((file) => gradleCoordinates(readFileSync(file, "utf8")));
  return rightsReport({ packages, reviews, components, gradle }).blockers;
}

/** The notices a release of this checkout carries, read from the repository root. */
export function releaseNotices(): Notice[] {
  const { components } = JSON.parse(readFileSync(COMPONENTS, "utf8")) as Recorded;
  return requiredNotices(recordedPackages(), components);
}

function check(): boolean {
  const blockers = rightsBlockers();
  const report = { ready: blockers.length === 0, blockers };
  for (const { subject, reason } of report.blockers) console.log(`blocked: ${subject}: ${reason}`);
  console.log(
    report.ready
      ? "Rights inventory: ready for GPL-3.0-only."
      : `Rights inventory: blocked by ${report.blockers.length} item(s).`,
  );
  return report.ready;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [command, flag, value] = process.argv.slice(2);
  if (command === "snapshot" && flag === "--node-modules" && value) await snapshot(value);
  else if (command === "check") process.exit(check() ? 0 : 1);
  else if (command === "notices") console.log(JSON.stringify(releaseNotices(), null, 2));
  else {
    console.error(
      "Usage: node scripts/ci/rights-inventory.ts snapshot --node-modules <dir> | check | notices",
    );
    process.exit(2);
  }
}
