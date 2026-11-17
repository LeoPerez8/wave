// The release gate: whether this run may open the release job, which holds the signing key and
// the publishing secrets. It reads the evidence of the jobs before it, as `toJSON(needs)`, and
// admits the release only when every prerequisite succeeded for the one release source this
// run selected. What it admits becomes the release's provenance record
// (docs/release-provenance.md), which the release job checks the APK against before signing it.
//   node scripts/ci/release-gate.ts admit <needs.json>   the provenance record, as one JSON line;
//                                                         reads the GITHUB_* names of the run
//   node scripts/ci/release-gate.ts digest <file|dir>     a file's SHA-256, or a folder's (digestOf)
//   node scripts/ci/release-gate.ts verify <provenance.json> <unsigned apk>
//   node scripts/ci/release-gate.ts verify-update <provenance.json> <update dir>
//   node scripts/ci/release-gate.ts seal <provenance.json> <signed apk>   the record, signed
// Every command fails, printing nothing to stdout, when the evidence doesn't hold. It uses no
// token, key or network.
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

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
  schema: "wave-release-provenance/1";
  /** The commit everything below was checked, scanned and built from. */
  source: string;
  /** v<version> when the run publishes a versioned release; empty for the ti-latest build. */
  releaseTag: string;
  /** The CI run that admitted it. */
  run: Run;
  artifact: Artifact;
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

/** Admits a release from its prerequisites' evidence, or throws why it's refused. */
export const admitRelease = (needs: unknown, run: Run = NO_RUN): Provenance => {
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
  return {
    schema: "wave-release-provenance/1",
    source,
    releaseTag,
    run,
    artifact: artifactOf(outputs.android, releaseTag),
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
  if (!/^unsigned-wave-[\w.-]+\.apk$/.test(artifact.name) || !/^wave-[\w.-]+\.apk$/.test(artifact.apk))
    refuse("android named no APK.");
  if (build === "full") {
    if (android.base) refuse("android built in full but named a kept base.");
    return artifact;
  }
  // Stable releases always build in full (repack.ts).
  if (releaseTag && !releaseTag.endsWith("-ti")) refuse(`${releaseTag} must build in full.`);
  const base = keptBuild(parse(android.base ?? ""));
  if (!base) return refuse("android repacked without a kept full build's record.");
  if (base.key !== runtimeVersion)
    refuse("android repacked a kept build of another native side.");
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
 * A file's SHA-256, or a folder's: the SHA-256 of its files' relative paths and SHA-256s, one
 * `<path> <sha256>
` line each, sorted by path.
 */
export const digestOf = (path: string): string => {
  if (!statSync(path).isDirectory()) return sha256(readFileSync(path));
  const files = (prefix: string): string[] =>
    readdirSync(join(path, prefix), { withFileTypes: true }).flatMap((entry) =>
      entry.isDirectory()
        ? files(`${prefix}${entry.name}/`)
        : [`${prefix}${entry.name}`],
    );
  return sha256(
    files("")
      .sort()
      .map((file) => `${file} ${sha256(readFileSync(join(path, file)))}
`)
      .join(""),
  );
};

const provenanceAt = (path: string): Provenance => {
  const value: unknown = parse(readFileSync(path, "utf8"));
  if (!record(value) || value.schema !== "wave-release-provenance/1" || !record(value.artifact))
    return refuse(`${path} holds no provenance record.`);
  return value as Provenance;
};

const runFromEnv = (env: NodeJS.ProcessEnv): Run => ({
  repository: env.GITHUB_REPOSITORY ?? "",
  id: Number(env.GITHUB_RUN_ID ?? 0),
  attempt: Number(env.GITHUB_RUN_ATTEMPT ?? 0),
  event: env.GITHUB_EVENT_NAME ?? "",
  ref: env.GITHUB_REF ?? "",
});

const cli = ([command, first, second]: string[]): string => {
  if (command === "admit" && first)
    return JSON.stringify(admitRelease(parse(readFileSync(first, "utf8")), runFromEnv(process.env)));
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
