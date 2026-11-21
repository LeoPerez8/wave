// The release gate: whether this run may open the release job, which holds the signing key and
// the publishing secrets. It reads the evidence of the jobs before it, as `toJSON(needs)`, and
// admits the release only when every prerequisite succeeded for the one release source this
// run selected. What it admits becomes the release's provenance record
// (docs/release-provenance.md), which the release job checks the APK against before signing it.
//   node scripts/ci/release-gate.ts admit <needs.json> [<ti record> [<ti tag>]]
//                                     the provenance record, as one JSON line; reads the GITHUB_*
//                                     names of the run. A stable tag needs the record of the ti
//                                     release it promotes (by default the same number's).
//   node scripts/ci/release-gate.ts digest <file|dir>     a file's SHA-256, or a folder's (digestOf)
//   node scripts/ci/release-gate.ts verify <provenance.json> <unsigned apk>
//   node scripts/ci/release-gate.ts verify-update <provenance.json> <update dir>
//   node scripts/ci/release-gate.ts seal <provenance.json> <signed apk>   the record, signed
//   node scripts/ci/release-gate.ts verify-release <record> <tag> <commit> [<signed apk>]
//                                     a published release's sealed record (verifyPublished)
//   node scripts/ci/release-gate.ts promote-desktop <ti desktop record> <ti tag> <stable tag> <source>
//                                     a stable desktop's link to its ti release (desktopPromotion)
//   node scripts/ci/release-gate.ts verify-desktop-release <record> <tag> <commit> [<promoted commit>]
//                                     a published desktop record (verifyDesktopPublished)
// Every command fails, printing nothing to stdout, when the evidence doesn't hold. It uses no
// token, key or network.
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { promotableSource } from "./promote-version.ts";

const SHA = /^[0-9a-f]{40}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const KEY = /^apk-v2-[0-9a-f]{64}$/;

/** The jobs whose success the release needs, in the order the gate reports them. */
const PREREQUISITES = [
  "source",
  "changes",
  "secret-scan",
  "checks",
  "native-tests",
  "notes",
  "android",
] as const;

type Prerequisite = (typeof PREREQUISITES)[number];

/** The prerequisites that check out the source and report the commit they checked out. */
const EVIDENCE = ["secret-scan", "checks", "native-tests", "notes", "android"] as const;
type Outputs = Record<string, string>;

export type Provenance = {
  desktop?: import("../../apps/updates/src/desktopEvidence.ts").DesktopEvidence;
  schema: "wave-release-provenance/1";
  /** The commit everything below was checked, scanned and built from. */
  source: string;
  /** v<version> when the run publishes a versioned release; empty for the ti-latest build. */
  releaseTag: string;
  /** The CI run that admitted it. */
  run: Run;
  artifact: Artifact;
  /** A stable release's tested ti release: same source, its sealed record (#1130). */
  promotedFrom?: Promotion;
};

export type Promotion = {
  releaseTag: string;
  source: string;
  run: Pick<Run, "repository" | "id" | "attempt">;
  /** The ti APK as its release published it. */
  signedSha256: string;
};

export type Run = { repository: string; id: number; attempt: number; event: string; ref: string };

/**
 * A full build kept for repacks: the APK without a signature, the commit and run that built it,
 * and its native key (repack.ts). Written beside the kept APK (kept-build.ts).
 */
export type KeptBuild = { source: string; run: number; key: string; unsignedSha256: string };

export type Artifact = {
  /** A full Gradle build, or this run's JS and Metro resources swapped into a kept full build. */
  build: "full" | "repack";
  /** The workflow artifact holding the unsigned APK, and the name it's signed as. */
  name: string;
  apk: string;
  unsignedSha256: string;
  /** The Hermes bundle the APK carries, built from the source by this run. */
  bundleSha256: string;
  /** The native key, which a repack shares with its base. */
  runtimeVersion: string;
  updateChannel: string;
  /** The exported over-the-air update (digestOf), or empty when the run exported none. */
  updateSha256: string;
  /** A repack's native base. */
  base?: KeptBuild;
  /** The APK the release job signed and published; only in a sealed record. */
  signedSha256?: string;
};

const refuse = (message: string): never => {
  throw new Error(`Release refused: ${message}`);
};

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** A prerequisite's outputs, once it's known to have succeeded. */
const succeeded = (needs: Record<string, unknown>, name: Prerequisite): Outputs => {
  const job = needs[name];
  if (!record(job)) return refuse(`${name} left no evidence.`);
  if (job.result !== "success") return refuse(`${name} did not succeed (${String(job.result)}).`);
  const outputs = record(job.outputs) ? job.outputs : {};
  return Object.fromEntries(
    Object.entries(outputs).map(([key, value]) => [key, typeof value === "string" ? value : ""]),
  );
};

/**
 * Admits a release from its prerequisites' evidence, or throws why it's refused. A stable
 * release also needs `promoted`: the sealed record of the ti release it promotes.
 */
export const admitRelease = (
  needs: unknown,
  run: Run = NO_RUN,
  promoted?: unknown,
  /** The ti release a promotion builds this app from; by default the same number's. */
  promotedTag?: string,
): Provenance => {
  if (!record(needs)) return refuse("no evidence.");
  const outputs = Object.fromEntries(
    PREREQUISITES.map((name) => [name, succeeded(needs, name)]),
  ) as Record<Prerequisite, Outputs>;
  const source = outputs.source.sha ?? "";
  if (!SHA.test(source)) refuse("source selected no commit.");
  // Each job reports the commit it actually checked out, not the one it was asked for.
  for (const name of EVIDENCE) {
    const checked = outputs[name].source ?? "";
    if (checked !== source)
      refuse(`${name} ran on ${checked.slice(0, 7) || "no commit"}, not ${source.slice(0, 7)}.`);
  }
  // The scan's commits must end at the source: those since the channel's previous release, or
  // the source's whole history.
  const range = outputs["secret-scan"].range ?? "";
  if (range !== source && !new RegExp(`^[0-9a-f]{40}\\.\\.${source}$`).test(range))
    refuse(`secret-scan scanned "${range}", not the commits up to ${source.slice(0, 7)}.`);
  // A release counts every area as changed (changes.sh), so its native tests always apply. Only
  // a PR's changed files can turn them off, and a PR never reaches this gate.
  if (outputs.changes.nativeTests !== "true")
    refuse("changes let the native tests skip, which only a PR may do.");
  const releaseTag = outputs.checks.release_tag ?? "";
  // The Patch notes job always succeeds, so a release reads the step's own outcome.
  if (releaseTag && outputs.notes.outcome !== "success")
    refuse(`notes were not built for ${releaseTag}.`);
  const artifact = artifactOf(outputs.android, releaseTag);
  const provenance: Provenance = {
    schema: "wave-release-provenance/1",
    source,
    releaseTag,
    run,
    artifact,
  };
  if (!releaseTag || releaseTag.endsWith("-ti")) return provenance;
  const tiTag = promotedTag || `${releaseTag}-ti`;
  const problem = promotableSource(releaseTag, tiTag);
  if (problem) refuse(problem);
  return { ...provenance, promotedFrom: promotionOf(promoted, tiTag, source) };
};

/**
 * What a stable release promotes: the phone's newest ti release at or below its number
 * (promote-version.ts), sealed by its release job and built from the same source. A ti release
 * from before the gate has no record, so it can't be promoted; a newer one can
 * (docs/release-provenance.md).
 */
const promotionOf = (value: unknown, tiTag: string, source: string): Promotion => {
  if (!record(value) || value.schema !== "wave-release-provenance/1" || !record(value.artifact))
    return refuse(`${tiTag} has no provenance record, so it can't be promoted.`);
  const { releaseTag, artifact } = value;
  if (releaseTag !== tiTag)
    refuse(`the promoted record is ${String(releaseTag)}'s, not ${tiTag}'s.`);
  if (value.source !== source)
    refuse(
      `${tiTag} was built from ${String(value.source).slice(0, 7)}, not ${source.slice(0, 7)}.`,
    );
  const signedSha256 = artifact.signedSha256;
  if (typeof signedSha256 !== "string" || !SHA256.test(signedSha256))
    refuse(`${tiTag}'s record isn't sealed, so its release never published it.`);
  const run = record(value.run) ? value.run : {};
  return {
    releaseTag: tiTag,
    source,
    run: {
      repository: String(run.repository ?? ""),
      id: Number(run.id ?? 0),
      attempt: Number(run.attempt ?? 0),
    },
    signedSha256: signedSha256 as string,
  };
};

/** The APK the Android job built and how, from its outputs. */
const artifactOf = (android: Outputs, releaseTag: string): Artifact => {
  const build = android.build;
  if (build !== "full" && build !== "repack") return refuse(`android built "${build}".`);
  const digest = (output: string) => {
    const value = android[output] ?? "";
    return SHA256.test(value) ? value : refuse(`android recorded no ${output}.`);
  };
  const runtimeVersion = android.runtime_version ?? "";
  if (!KEY.test(runtimeVersion)) refuse("android recorded no runtime version.");
  const updateSha256 = android.update_sha256 ?? "";
  if (updateSha256 && !SHA256.test(updateSha256)) refuse("android recorded a malformed update.");
  const artifact: Artifact = {
    build,
    name: android.artifact ?? "",
    apk: android.apk ?? "",
    unsignedSha256: digest("apk_sha256"),
    bundleSha256: digest("bundle_sha256"),
    runtimeVersion,
    updateChannel: android.update_channel ?? "",
    updateSha256,
  };
  if (
    !/^unsigned-wave-[\w.-]+\.apk$/.test(artifact.name) ||
    !/^wave-[\w.-]+\.apk$/.test(artifact.apk)
  )
    refuse("android named no APK.");
  if (build === "full") {
    if (android.base) refuse("android built in full but named a kept base.");
    return artifact;
  }
  // Stable releases always build in full (repack.ts).
  if (releaseTag && !releaseTag.endsWith("-ti")) refuse(`${releaseTag} must build in full.`);
  const base = keptBuild(parse(android.base ?? ""));
  if (!base) return refuse("android repacked without a kept full build's record.");
  if (base.key !== runtimeVersion) refuse("android repacked a kept build of another native side.");
  return { ...artifact, base };
};

const parse = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
};

/** A kept full build's record, or undefined when the value isn't one. */
export const keptBuild = (value: unknown): KeptBuild | undefined => {
  if (!record(value)) return undefined;
  const { source, run, key, unsignedSha256 } = value;
  if (typeof source !== "string" || !SHA.test(source)) return undefined;
  if (typeof run !== "number" || !Number.isSafeInteger(run) || run <= 0) return undefined;
  if (typeof key !== "string" || !KEY.test(key)) return undefined;
  if (typeof unsignedSha256 !== "string" || !SHA256.test(unsignedSha256)) return undefined;
  return { source, run, key, unsignedSha256 };
};

const NO_RUN: Run = { repository: "", id: 0, attempt: 0, event: "", ref: "" };

const sha256 = (data: string | Buffer) => createHash("sha256").update(data).digest("hex");

/**
 * A folder's digest from its files' SHA-256s, by relative path: the SHA-256 of one
 * `<path>\0<sha256>\n` line per file (a NUL between them), sorted by path.
 */
export const digestOfFiles = (files: Readonly<Record<string, string>>): string =>
  sha256(
    Object.keys(files)
      .sort()
      .map((file) => `${file}\0${files[file]}\n`)
      .join(""),
  );

/** A file's SHA-256, or a folder's (`digestOfFiles` of its files). */
export const digestOf = (path: string): string => {
  if (!statSync(path).isDirectory()) return sha256(readFileSync(path));
  const files = (prefix: string): string[] =>
    readdirSync(join(path, prefix), { withFileTypes: true }).flatMap((entry) =>
      entry.isDirectory() ? files(`${prefix}${entry.name}/`) : [`${prefix}${entry.name}`],
    );
  return digestOfFiles(
    Object.fromEntries(files("").map((file) => [file, sha256(readFileSync(join(path, file)))])),
  );
};

const provenanceAt = (path: string): Provenance => {
  const value: unknown = parse(readFileSync(path, "utf8"));
  if (!record(value) || value.schema !== "wave-release-provenance/1" || !record(value.artifact))
    return refuse(`${path} holds no provenance record.`);
  return value as Provenance;
};

/**
 * Checks a published release's sealed record (`wave-<version>.provenance.json`): it names this
 * tag, the tag's commit as its source and, given the release's APK, that APK as the one it signed.
 * Promotion and rollback trust a release only through this (docs/release-provenance.md).
 */
export const verifyPublished = (
  value: unknown,
  { tag, commit, signedSha256 }: { tag: string; commit: string; signedSha256?: string },
): Provenance => {
  if (!record(value) || value.schema !== "wave-release-provenance/1" || !record(value.artifact))
    return refuse(`${tag} has no provenance record.`);
  const provenance = value as Provenance;
  if (provenance.releaseTag !== tag)
    refuse(`the record is ${provenance.releaseTag}'s, not ${tag}'s.`);
  const source: unknown = provenance.source;
  const named = typeof source === "string" && SHA.test(source) ? source.slice(0, 7) : "no commit";
  if (!SHA.test(commit) || source !== commit)
    refuse(`${tag} is on ${commit.slice(0, 7)}, but its record names ${named}.`);
  const sealed = provenance.artifact.signedSha256 ?? "";
  if (!SHA256.test(sealed)) refuse(`${tag}'s record isn't sealed, so its release never signed it.`);
  if (signedSha256 !== undefined && signedSha256 !== sealed)
    refuse(`${tag}'s APK isn't the one its record sealed (${sealed}).`);
  return provenance;
};

/** A stable desktop release's link to the ti release its installers were built from. */
export type DesktopPromotion = { releaseTag: string; source: string };

/** The desktop's admission in a record: its own (#1336), or the phone's from before. */
const desktopOf = (value: unknown, tag: string) => {
  if (!record(value) || value.schema !== "wave-release-provenance/1")
    return refuse(`${tag} has no desktop record.`);
  const desktop = value.desktop;
  if (!record(desktop) || desktop.tag !== value.releaseTag || desktop.source !== value.source)
    return refuse(`${tag}'s record admitted no desktop installers.`);
  return value;
};

/**
 * What a stable desktop release promotes: the desktop's newest ti release at or below its number
 * (promote-version.ts), whose record admitted installers built from this run's source.
 */
export const desktopPromotion = (
  value: unknown,
  { tiTag, stableTag, source }: { tiTag: string; stableTag: string; source: string },
): DesktopPromotion => {
  const problem = promotableSource(stableTag, tiTag);
  if (problem) refuse(problem);
  const ti = desktopOf(value, tiTag);
  if (ti.releaseTag !== tiTag)
    refuse(`the promoted desktop record is ${String(ti.releaseTag)}'s, not ${tiTag}'s.`);
  if (ti.source !== source)
    refuse(`${tiTag} was built from ${String(ti.source).slice(0, 7)}, not ${source.slice(0, 7)}.`);
  return { releaseTag: tiTag, source };
};

/**
 * Checks a published desktop record (`wave-<version>.desktop.provenance.json`, or the phone's
 * record before #1336): it is this tag's, admitted installers, and names the tag's commit as its
 * source. A stable release whose desktop came from an older ti release than the phone's names that
 * release's commit instead (`promotedFrom`), which the caller looks up as `promotedCommit`.
 */
export const verifyDesktopPublished = (
  value: unknown,
  { tag, commit, promotedCommit }: { tag: string; commit: string; promotedCommit?: string },
): Record<string, unknown> => {
  const desktop = desktopOf(value, tag);
  if (desktop.releaseTag !== tag)
    refuse(`the desktop record is ${String(desktop.releaseTag)}'s, not ${tag}'s.`);
  const source = typeof desktop.source === "string" ? desktop.source : "";
  if (!SHA.test(source)) refuse(`${tag}'s desktop record names no commit.`);
  if (source === commit) return desktop;
  const promoted = desktop.promotedFrom;
  if (!record(promoted) || promoted.source !== source || typeof promoted.releaseTag !== "string")
    return refuse(
      `${tag} is on ${commit.slice(0, 7)}, but its desktop record names ${source.slice(0, 7)}.`,
    );
  const problem = promotableSource(tag, promoted.releaseTag);
  if (problem) refuse(problem);
  if (promotedCommit !== source)
    refuse(
      `${tag} is on ${commit.slice(0, 7)} and ${promoted.releaseTag} is on ` +
        `${(promotedCommit ?? "").slice(0, 7) || "no commit"}, but ${tag}'s desktop record ` +
        `names ${source.slice(0, 7)}.`,
    );
  return desktop;
};

const runFromEnv = (env: NodeJS.ProcessEnv): Run => ({
  repository: env.GITHUB_REPOSITORY ?? "",
  id: Number(env.GITHUB_RUN_ID ?? 0),
  attempt: Number(env.GITHUB_RUN_ATTEMPT ?? 0),
  event: env.GITHUB_EVENT_NAME ?? "",
  ref: env.GITHUB_REF ?? "",
});

/** A file's JSON, or undefined when it's missing or isn't JSON. */
const readJson = (path: string | undefined): unknown =>
  path && existsSync(path) ? parse(readFileSync(path, "utf8")) : undefined;

const cli = ([command, first, second, third, fourth]: string[]): string => {
  if (command === "admit" && first)
    return JSON.stringify(
      admitRelease(
        parse(readFileSync(first, "utf8")),
        runFromEnv(process.env),
        readJson(second),
        third,
      ),
    );
  if (command === "promote-desktop" && first && second && third && fourth)
    return JSON.stringify(
      desktopPromotion(readJson(first), { tiTag: second, stableTag: third, source: fourth }),
    );
  if (command === "verify-desktop-release" && first && second && third) {
    const desktop = verifyDesktopPublished(readJson(first), {
      tag: second,
      commit: third,
      ...(fourth ? { promotedCommit: fourth } : {}),
    });
    return `Verified ${second}'s desktop record: ${String(desktop.source)}`;
  }
  if (command === "digest" && first) return digestOf(first);
  if (command === "verify" && first && second) {
    const { artifact } = provenanceAt(first);
    if (digestOf(second) !== artifact.unsignedSha256)
      refuse(`${second} is not the APK the gate admitted (${artifact.unsignedSha256}).`);
    return `Admitted APK: ${artifact.unsignedSha256}`;
  }
  if (command === "verify-update" && first && second) {
    const { artifact } = provenanceAt(first);
    if (!artifact.updateSha256 || digestOf(second) !== artifact.updateSha256)
      refuse(`${second} is not the update the gate admitted.`);
    return `Admitted update: ${artifact.updateSha256}`;
  }
  if (command === "seal" && first && second) {
    const provenance = provenanceAt(first);
    return JSON.stringify({
      ...provenance,
      artifact: { ...provenance.artifact, signedSha256: digestOf(second) },
    });
  }
  if (command === "verify-release" && first && second && third) {
    const provenance = verifyPublished(readJson(first), {
      tag: second,
      commit: third,
      ...(fourth ? { signedSha256: digestOf(fourth) } : {}),
    });
    return `Verified ${second}: ${provenance.source}, APK ${provenance.artifact.signedSha256}`;
  }
  throw new Error(`Unknown or incomplete command: ${command ?? "(none)"}`);
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    console.log(cli(process.argv.slice(2)));
  } catch (cause) {
    console.error(cause instanceof Error ? cause.message : String(cause));
    process.exitCode = 1;
  }
}
