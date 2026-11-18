// Where a release's source is (docs/release-source.md): one manifest per released version that
// pins the commit it was built from, a repack's native base, the files that drive the build, the
// version configuration CI generated, the third-party source the GPL asks for and the notices
// from the rights inventory (docs/licensing/). It holds links and digests, never a credential.
//   node scripts/ci/release-source.ts manifest <sealed.json>   from the release job's sealed record
//   node scripts/ci/release-source.ts legacy <tag> --instructions-at <sha>   one from before the gate
//   node scripts/ci/release-source.ts directions <manifest>    the Markdown shown beside the APK
//   node scripts/ci/release-source.ts verify <manifest>        checks it against this clone's git
// `manifest` reads the inventory and build files from the current checkout, which must be the
// release's source. `legacy` reads the tag through git and the inventory from the checkout, since
// old tags have none. `verify` reads only git.

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Blocker, Component, Notice } from "./rights-inventory.ts";

const SHA = /^[0-9a-f]{40}$/;
const SHA256 = /^[0-9a-f]{64}$/;

/** A commit, with links that keep naming it after main moves on. */
export type Revision = { revision: string; archive: string; tree: string };

export type SourceManifest = {
  schema: "wave-release-source/1";
  /** The version phones see: the tag's, which a promotion takes without -ti. */
  version: string;
  releaseTag: string;
  /** Whether the release gate's sealed record backs this, or only the tag (before the gate). */
  provenance: "sealed-record" | "none";
  source: Revision;
  /** A repack's native base needs its own source too; unknown before the gate. */
  build: "full" | "repack" | "unknown";
  nativeBase: (Revision & { runtimeVersion: string }) | null;
  /** For a stable release, the ti release it promotes: same source, its own sealed APK. */
  promotedFrom: { releaseTag: string; signedSha256: string } | null;
  /** The build instructions as they stood at a fixed commit. */
  instructions: string;
  /** What CI generated on top of the source tree. */
  generated: {
    versionName: string;
    versionCode: number;
    updateChannel: string;
    runtimeVersion: string;
  };
  artifacts: {
    apk: string;
    signedSha256: string;
    unsignedSha256: string;
    bundleSha256: string;
    updateSha256: string;
  } | null;
  /** Paths in the source tree that a build reads, beyond the app's own code. */
  buildInputs: string[];
  thirdPartySource: { subject: string; licence: string | undefined; source: string }[];
  notices: Notice[];
  /** What this manifest can't settle yet: open rights items and missing evidence. */
  pending: string[];
};

/** A rights-inventory component, with where its exact source can be fetched when the GPL asks. */
export type SourcedComponent = Component & { correspondingSource?: string };

export type SourceInputs = {
  repository: string;
  /** apps/mobile/package.json's version at the source. */
  version: string;
  buildInputs: string[];
  components: SourcedComponent[];
  notices: Notice[];
  blockers: Blocker[];
  /** Where the build instructions are read: the source itself unless it predates them. */
  instructionsAt?: string;
} & (
  | { record: unknown }
  | {
      legacy: {
        tag: string;
        commit: string;
        /** The commit whose inventory supplied the notices, when it isn't the tag's own. */
        inventoryAt?: string;
        /** Whether the tag's pnpm-lock.yaml is the one that inventory read. */
        lockfileMatches?: boolean;
      };
    }
);

const refuse = (message: string): never => {
  throw new Error(`No source manifest: ${message}`);
};

const object = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const text = (from: Record<string, unknown>, key: string): string =>
  typeof from[key] === "string" ? from[key] : "";

const revision = (repository: string, sha: string): Revision => ({
  revision: sha,
  archive: `https://github.com/${repository}/archive/${sha}.tar.gz`,
  tree: `https://github.com/${repository}/tree/${sha}`,
});

// The release tag rules of apps/mobile/plugins/appVersion.ts, which CI can't import (it's app code).
const VERSION = /^(\d+)\.(\d{1,2})\.(\d{1,2})(?:-ti)?$/;

/** Android's versionCode for a version, as app.config.ts derives it. */
const versionCode = (version: string): number => {
  const [major = 0, minor = 0, patch = 0] = (VERSION.exec(version) ?? []).slice(1).map(Number);
  return major * 10000 + minor * 100 + patch;
};

/** Why [tag] can't release the app at [version]; a stable tag may name its -ti commit. */
const releaseTagProblem = (tag: string, version: string): string | undefined =>
  VERSION.test(tag.slice(1)) && (tag === `v${version}` || `${tag}-ti` === `v${version}`)
    ? undefined
    : `The tag ${tag} doesn't match the app's version, ${version} (apps/mobile/package.json).`;

/** The version a tag publishes, after checking it names the source's app version. */
const tagVersion = (tag: string, version: string): string => {
  const problem = releaseTagProblem(tag, version);
  if (problem) refuse(problem);
  return tag.slice(1);
};

/** Builds the manifest, copying only known fields so nothing else in a record can leak into it. */
export const releaseSource = (inputs: SourceInputs): SourceManifest => {
  const { repository } = inputs;
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository)) refuse(`"${repository}" isn't owner/name.`);
  const pending = inputs.blockers.map(({ subject, reason }) => `${subject}: ${reason}`);
  const thirdPartySource = inputs.components
    .filter((component) => component.correspondingSource !== undefined)
    .map((component) => ({
      subject: component.id,
      licence: component.licence,
      source: component.correspondingSource!,
    }));
  const common = {
    schema: "wave-release-source/1" as const,
    buildInputs: [...inputs.buildInputs],
    thirdPartySource,
    notices: inputs.notices,
  };
  const instructions = (source: string): string => {
    const at = inputs.instructionsAt ?? source;
    if (!SHA.test(at)) refuse(`the instructions' commit "${at}" isn't a full SHA.`);
    return `https://github.com/${repository}/blob/${at}/docs/release-source.md`;
  };

  if ("legacy" in inputs) {
    const { tag, commit, inventoryAt, lockfileMatches } = inputs.legacy;
    if (!SHA.test(commit)) refuse(`${tag}'s commit "${commit}" isn't a full SHA.`);
    const version = tagVersion(tag, inputs.version);
    return {
      ...common,
      version,
      releaseTag: tag,
      provenance: "none",
      source: revision(repository, commit),
      build: "unknown",
      nativeBase: null,
      promotedFrom: null,
      instructions: instructions(commit),
      generated: {
        versionName: version,
        versionCode: versionCode(version),
        updateChannel: version.endsWith("-ti") ? "ti" : "main",
        runtimeVersion: "",
      },
      artifacts: null,
      pending: [
        `${tag}: published before the release gate, so no record says whether its APK was a ` +
          "full build or a repack, or which commit a repack's native base came from.",
        ...(inventoryAt && lockfileMatches === false
          ? [
              `${tag}: its notices come from the inventory at ${inventoryAt}, whose ` +
                "pnpm-lock.yaml differs from this release's; its own package list needs a snapshot.",
            ]
          : []),
        ...pending,
      ],
    };
  }

  const record = inputs.record;
  if (!object(record) || record.schema !== "wave-release-provenance/1")
    return refuse("not a release provenance record.");
  const source = text(record, "source");
  if (!SHA.test(source)) refuse(`the record's source "${source}" isn't a full SHA.`);
  const tag = text(record, "releaseTag");
  if (!tag) refuse("the record has no release tag; a ti-latest build isn't a release.");
  const version = tagVersion(tag, inputs.version);
  const artifact = object(record.artifact)
    ? record.artifact
    : refuse("the record has no artifact.");
  for (const key of ["signedSha256", "unsignedSha256", "bundleSha256"])
    if (!SHA256.test(text(artifact, key)))
      refuse(`the record's ${key} is missing; only a sealed record names what was published.`);
  const build = text(artifact, "build");
  if (build !== "full" && build !== "repack") return refuse(`unknown build "${build}".`);
  const runtimeVersion = text(artifact, "runtimeVersion");
  let nativeBase: SourceManifest["nativeBase"] = null;
  if (build === "repack") {
    const base = object(artifact.base) ? artifact.base : refuse("a repack names no native base.");
    const baseSource = text(base, "source");
    if (!SHA.test(baseSource)) refuse(`the native base's source "${baseSource}" isn't a full SHA.`);
    if (text(base, "key") !== runtimeVersion)
      refuse("the native base was built for another runtime version.");
    nativeBase = { ...revision(repository, baseSource), runtimeVersion };
  }
  let promotedFrom: SourceManifest["promotedFrom"] = null;
  if (object(record.promotedFrom)) {
    const from = record.promotedFrom;
    if (text(from, "source") !== source) refuse("the record promotes another source.");
    promotedFrom = {
      releaseTag: text(from, "releaseTag"),
      signedSha256: text(from, "signedSha256"),
    };
  }
  return {
    ...common,
    version,
    releaseTag: tag,
    provenance: "sealed-record",
    promotedFrom,
    source: revision(repository, source),
    build,
    nativeBase,
    instructions: instructions(source),
    generated: {
      versionName: version,
      versionCode: versionCode(version),
      updateChannel: text(artifact, "updateChannel"),
      runtimeVersion,
    },
    artifacts: {
      apk: `wave-${version}.apk`,
      signedSha256: text(artifact, "signedSha256"),
      unsignedSha256: text(artifact, "unsignedSha256"),
      bundleSha256: text(artifact, "bundleSha256"),
      updateSha256: text(artifact, "updateSha256"),
    },
    pending,
  };
};

/** The directions published next to the APK (GPLv3 §6(d)): where its source is, by commit. */
export const sourceDirections = (manifest: SourceManifest): string => {
  const lines = [
    `## Source for Wave ${manifest.version}`,
    "",
    `This release was built from commit \`${manifest.source.revision}\`.`,
    "",
    `- Source: ${manifest.source.archive} (browse: ${manifest.source.tree})`,
  ];
  if (manifest.nativeBase)
    lines.push(
      `- The APK repacks a native build from commit \`${manifest.nativeBase.revision}\`, so its ` +
        `source is part of this release's too: ${manifest.nativeBase.archive}`,
    );
  if (manifest.build === "unknown")
    lines.push(
      "- Released before Wave recorded how each APK was built: if it was a repack, its native " +
        "part came from an earlier commit on the same history.",
    );
  lines.push(
    `- Build instructions, as of that commit: ${manifest.instructions}`,
    `- \`wave-${manifest.version}.source.json\` lists the build inputs, the generated version ` +
      `(${manifest.generated.versionName}, code ${manifest.generated.versionCode}) and ` +
      `${manifest.notices.length} third-party notices.`,
    "",
    "Build it with your own signing key and your own service configuration, or leave the hosted " +
      "features off. Wave's keys and service credentials aren't part of the source, and nothing " +
      "in it needs them to play music from your Library.",
  );
  if (manifest.thirdPartySource.length > 0) {
    lines.push("", "Third-party source this release carries under the GPL family:", "");
    for (const { subject, licence, source } of manifest.thirdPartySource)
      lines.push(`- ${subject} (${licence ?? "see its notice"}): ${source}`);
  }
  if (manifest.pending.length > 0) {
    lines.push("", "Not settled yet for this release:", "");
    for (const item of manifest.pending) lines.push(`- ${item}`);
  }
  return `${lines.join("\n")}\n`;
};

/**
 * The app version a commit names: apps/mobile/package.json's, or on the earliest tags (v0.5.x),
 * the `const version` app.config.ts held before the version moved to package.json.
 */
export const appVersionAt = (packageJson: string, appConfig: string): string => {
  try {
    const { version } = JSON.parse(packageJson) as { version?: unknown };
    if (typeof version === "string") return version;
  } catch {
    // Read as having no version.
  }
  return /^const version = "([^"]+)";$/m.exec(appConfig)?.[1] ?? "";
};

const git = (dir: string, ...args: string[]) =>
  spawnSync("git", ["-C", dir, ...args], { encoding: "utf8" });

/** The commit [ref] names in [dir], or undefined when it names none. */
const commitOf = (dir: string, ref: string): string | undefined => {
  const result = git(dir, "rev-parse", "--verify", "--quiet", `${ref}^{commit}`);
  return result.status === 0 ? result.stdout.trim() : undefined;
};

/**
 * What doesn't hold between [manifest] and the repository at [dir]: the tag names the source, the
 * source's app version names the tag, every build input and the instructions exist at their
 * commit, a repack's base is in the source's history, and each link names a commit. Read only.
 */
export const verifySource = (manifest: SourceManifest, dir: string): string[] => {
  const problems: string[] = [];
  const { revision: source } = manifest.source;
  if (commitOf(dir, source) !== source) return [`The source commit ${source} isn't in ${dir}.`];
  const tagged = commitOf(dir, `refs/tags/${manifest.releaseTag}`);
  if (tagged !== source)
    problems.push(`${manifest.releaseTag} is on ${tagged ?? "no commit"}, not on ${source}.`);
  const show = (path: string) => git(dir, "show", `${source}:${path}`).stdout;
  const version = appVersionAt(show("apps/mobile/package.json"), show("apps/mobile/app.config.ts"));
  const versionProblem = releaseTagProblem(manifest.releaseTag, version);
  if (versionProblem) problems.push(versionProblem);
  for (const path of manifest.buildInputs)
    if (git(dir, "cat-file", "-e", `${source}:${path}`).status !== 0)
      problems.push(`The build input ${path} isn't in ${source}.`);
  if (manifest.nativeBase) {
    const base = manifest.nativeBase.revision;
    if (
      commitOf(dir, base) !== base ||
      git(dir, "merge-base", "--is-ancestor", base, source).status !== 0
    )
      problems.push(`The native base ${base} isn't in the history of ${source}.`);
  }
  const ownLinks = JSON.stringify(manifest).match(
    /https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/(?:archive|tree|blob)\/[^"]*/g,
  );
  for (const link of ownLinks ?? []) {
    if (manifest.thirdPartySource.some(({ source: third }) => third === link)) continue;
    const at = /\/(?:archive|tree|blob)\/([^/.]+)/.exec(link)?.[1] ?? "";
    if (!SHA.test(at)) problems.push(`${link} doesn't name a commit.`);
    else if (
      link.includes("/blob/") &&
      git(dir, "cat-file", "-e", `${at}:docs/release-source.md`).status !== 0
    )
      problems.push(`The instructions at ${at} don't exist.`);
  }
  return problems;
};

/** The files the build reads besides the app's code, those present in this checkout. */
const BUILD_INPUTS = [
  "package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  ".npmrc",
  ".nvmrc",
  "tsconfig.base.json",
  "apps/mobile/package.json",
  "apps/mobile/app.config.ts",
  "apps/mobile/metro.config.js",
  "apps/mobile/plugins",
  "apps/mobile/modules",
  "apps/mobile/certs/certificate.pem",
  "packages/core",
  "scripts/ci/bundle.sh",
  "scripts/ci/export-update.sh",
  "scripts/ci/prebuilt-bundle.gradle",
  "scripts/ci/repack.sh",
  "scripts/ci/repack.ts",
  "scripts/ci/update-config.ts",
  "scripts/ci/apk-version.ts",
  "scripts/ci/build-label.ts",
  "scripts/emulator-apk.sh",
  "docs/release-source.md",
  "docs/release-provenance.md",
  "docs/licensing/rights-inventory.md",
  "docs/licensing/components.json",
  "docs/licensing/npm-packages.json",
];

const inventoryInputs = async () => {
  const inventory = await import("./rights-inventory.ts");
  const { components } = JSON.parse(readFileSync("docs/licensing/components.json", "utf8")) as {
    components: SourcedComponent[];
  };
  return {
    components,
    notices: inventory.releaseNotices(),
    blockers: inventory.rightsBlockers(),
    buildInputs: BUILD_INPUTS.filter((path) => existsSync(path)),
    version: (JSON.parse(readFileSync("apps/mobile/package.json", "utf8")) as { version: string })
      .version,
  };
};

const repositoryName = (): string =>
  process.env.GITHUB_REPOSITORY ??
  /github\.com[:/]([\w.-]+\/[\w.-]+?)(?:\.git)?$/.exec(
    git(".", "remote", "get-url", "origin").stdout.trim(),
  )?.[1] ??
  refuse("set GITHUB_REPOSITORY to owner/name.");

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [command, argument, ...rest] = process.argv.slice(2);
  const option = (name: string) => {
    const at = rest.indexOf(name);
    return at === -1 ? undefined : rest[at + 1];
  };
  try {
    if (command === "manifest" && argument) {
      const record: unknown = JSON.parse(readFileSync(argument, "utf8"));
      const manifest = releaseSource({
        ...(await inventoryInputs()),
        repository: repositoryName(),
        record,
      });
      console.log(JSON.stringify(manifest, null, 2));
    } else if (command === "legacy" && argument) {
      const commit = commitOf(".", `refs/tags/${argument}`) ?? refuse(`no tag ${argument} here.`);
      const instructionsAt =
        option("--instructions-at") ?? refuse("name the commit holding the instructions.");
      const lockfile = (rev: string) =>
        git(".", "rev-parse", `${rev}:pnpm-lock.yaml`).stdout.trim();
      const head = commitOf(".", "HEAD") ?? refuse("no HEAD.");
      const show = (path: string) => git(".", "show", `${commit}:${path}`).stdout;
      const manifest = releaseSource({
        ...(await inventoryInputs()),
        version: appVersionAt(show("apps/mobile/package.json"), show("apps/mobile/app.config.ts")),
        buildInputs: BUILD_INPUTS.filter(
          (path) => git(".", "cat-file", "-e", `${commit}:${path}`).status === 0,
        ),
        repository: repositoryName(),
        legacy: {
          tag: argument,
          commit,
          inventoryAt: head,
          lockfileMatches: lockfile(commit) === lockfile(head),
        },
        instructionsAt,
      });
      console.log(JSON.stringify(manifest, null, 2));
    } else if (command === "directions" && argument) {
      process.stdout.write(
        sourceDirections(JSON.parse(readFileSync(argument, "utf8")) as SourceManifest),
      );
    } else if (command === "verify" && argument) {
      const problems = verifySource(
        JSON.parse(readFileSync(argument, "utf8")) as SourceManifest,
        ".",
      );
      for (const problem of problems) console.log(`problem: ${problem}`);
      console.log(
        problems.length === 0 ? "Release source verified." : `${problems.length} problem(s).`,
      );
      process.exit(problems.length === 0 ? 0 : 1);
    } else {
      console.error(
        "Usage: node scripts/ci/release-source.ts manifest <sealed.json> | legacy <tag> " +
          "[--instructions-at <sha>] | directions <manifest> | verify <manifest>",
      );
      process.exit(2);
    }
  } catch (error) {
    console.error((error as Error).message);
    process.exit(1);
  }
}
