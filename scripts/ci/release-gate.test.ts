import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { admitRelease } from "./release-gate.ts";

const gate = fileURLToPath(new URL("./release-gate.ts", import.meta.url));
const run = (args: string[], env: Record<string, string> = {}) =>
  spawnSync(process.execPath, [gate, ...args], {
    encoding: "utf8",
    env: { ...process.env, ...env },
  });

// The release source: the version bump the Version job pushed on top of the pushed commit.
const SOURCE = "b".repeat(40);
// The commit the push event named, before the bump.
const EVENT = "a".repeat(40);
const KEY = `apk-v2-${"c".repeat(64)}`;
const APK = "d".repeat(64);
const BUNDLE = "e".repeat(64);

const job = (outputs: Record<string, string> = {}) => ({ result: "success", outputs });

/** What `toJSON(needs)` gives the gate on a healthy push to main that releases v1.3.0-ti. */
const healthy = () => ({
  source: job({ sha: SOURCE }),
  changes: job({ nativeTests: "true" }),
  "secret-scan": job({ source: SOURCE, range: `${"9".repeat(40)}..${SOURCE}` }),
  checks: job({ source: SOURCE, sha: SOURCE, release_tag: "v1.3.0-ti" }),
  "native-tests": job({ source: SOURCE }),
  notes: job({ source: SOURCE, outcome: "success" }),
  android: job({
    source: SOURCE,
    build: "full",
    artifact: `unsigned-wave-${SOURCE.slice(0, 7)}.apk`,
    apk: `wave-${SOURCE.slice(0, 7)}.apk`,
    apk_sha256: APK,
    bundle_sha256: BUNDLE,
    runtime_version: KEY,
    update_channel: "ti",
    update_sha256: "",
    base: "",
  }),
});

type Needs = ReturnType<typeof healthy>;
type Name = keyof Needs;
const REQUIRED: Name[] = [
  "source",
  "changes",
  "secret-scan",
  "checks",
  "native-tests",
  "notes",
  "android",
];

const refuses = (needs: unknown, why: RegExp) => assert.throws(() => admitRelease(needs), why);

describe("admitRelease", () => {
  it("admits a healthy release and records the source it verified", () => {
    const provenance = admitRelease(healthy());
    assert.equal(provenance.source, SOURCE);
    assert.equal(provenance.releaseTag, "v1.3.0-ti");
    assert.equal(provenance.artifact.unsignedSha256, APK);
    assert.equal(provenance.artifact.build, "full");
  });

  it("refuses a prerequisite that failed, was cancelled, was skipped or is missing", () => {
    for (const name of REQUIRED) {
      for (const result of ["failure", "cancelled", "skipped", ""]) {
        const needs = healthy();
        needs[name] = { ...needs[name], result };
        refuses(needs, new RegExp(name));
      }
      const { [name]: _missing, ...rest } = healthy();
      refuses(rest, new RegExp(name));
    }
  });

  it("refuses evidence for the event's commit instead of the version bump on top of it", () => {
    for (const name of ["secret-scan", "checks", "native-tests", "notes", "android"] as const) {
      const needs = healthy();
      needs[name] = { ...needs[name], outputs: { ...needs[name].outputs, source: EVENT } };
      refuses(needs, new RegExp(`${name}.*${EVENT.slice(0, 7)}`));
    }
  });

  it("refuses a secret scan whose commits end anywhere but the release source", () => {
    for (const range of [`${"9".repeat(40)}..${EVENT}`, `-1 ${EVENT}`, "--all", ""]) {
      const needs = healthy();
      needs["secret-scan"].outputs.range = range;
      refuses(needs, /secret-scan/);
    }
  });

  it("refuses a release whose change detection let the native tests skip", () => {
    // Only a PR's changed files can turn them off; a release counts every area as changed.
    const needs = healthy();
    needs.changes.outputs.nativeTests = "false";
    refuses(needs, /native/);
  });

  it("refuses a versioned release without its patch notes, but not the ti-latest build", () => {
    const failed = healthy();
    failed.notes.outputs.outcome = "failure";
    refuses(failed, /notes/);
    failed.checks.outputs.release_tag = "";
    assert.equal(admitRelease(failed).releaseTag, "");
  });

  it("records a repack's native base: the kept full build, its source and its run", () => {
    const base = { source: EVENT, run: 41, key: KEY, unsignedSha256: "f".repeat(64) };
    const needs = healthy();
    needs.android.outputs.build = "repack";
    needs.android.outputs.base = JSON.stringify(base);
    const { artifact } = admitRelease(needs);
    assert.equal(artifact.build, "repack");
    assert.deepEqual(artifact.base, base);
    // The JS and resources the repack published are this run's.
    assert.equal(artifact.bundleSha256, BUNDLE);
    assert.equal(artifact.runtimeVersion, KEY);
  });

  it("refuses a repack without a kept build of the same native side behind it", () => {
    const base = { source: EVENT, run: 41, key: KEY, unsignedSha256: "f".repeat(64) };
    for (const kept of ["", "{}", JSON.stringify({ ...base, key: `apk-v2-${"0".repeat(64)}` })]) {
      const needs = healthy();
      needs.android.outputs.build = "repack";
      needs.android.outputs.base = kept;
      refuses(needs, /android/);
    }
  });

  it("refuses a stable release that was repacked", () => {
    const needs = healthy();
    needs.checks.outputs.release_tag = "v1.3.0";
    needs.android.outputs.build = "repack";
    needs.android.outputs.base = JSON.stringify({
      source: EVENT,
      run: 41,
      key: KEY,
      unsignedSha256: "f".repeat(64),
    });
    refuses(needs, /full/);
  });

  it("refuses an APK or bundle without a digest, or a build mode it doesn't know", () => {
    for (const [output, value] of [
      ["apk_sha256", ""],
      ["bundle_sha256", "nope"],
      ["build", "debug"],
      ["runtime_version", ""],
    ] as const) {
      const needs = healthy();
      needs.android.outputs[output] = value;
      refuses(needs, /android/);
    }
  });

  it("records the over-the-air update's digest when the run exported one", () => {
    const needs = healthy();
    assert.equal(admitRelease(needs).artifact.updateSha256, "");
    needs.android.outputs.update_sha256 = "1".repeat(64);
    assert.equal(admitRelease(needs).artifact.updateSha256, "1".repeat(64));
  });

  it("accepts a scan of the release source's whole history, as when no release precedes it", () => {
    const needs = healthy();
    needs["secret-scan"].outputs.range = SOURCE;
    assert.equal(admitRelease(needs).source, SOURCE);
  });
});

describe("release-gate.ts in the release job", () => {
  const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");

  /** An admitted release whose unsigned APK and update are files in a scratch folder. */
  const admitted = () => {
    const dir = mkdtempSync(join(tmpdir(), "wave-gate-"));
    writeFileSync(join(dir, "unsigned.apk"), "unsigned apk");
    mkdirSync(join(dir, "update/bundles"), { recursive: true });
    writeFileSync(join(dir, "update/metadata.json"), "{}");
    writeFileSync(join(dir, "update/bundles/android.hbc"), "bundle");
    const update = run(["digest", join(dir, "update")]);
    assert.equal(update.status, 0, update.stderr);
    const needs = healthy();
    needs.android.outputs.apk_sha256 = sha256("unsigned apk");
    needs.android.outputs.update_sha256 = update.stdout.trim();
    writeFileSync(join(dir, "needs.json"), JSON.stringify(needs));
    const admit = run(["admit", join(dir, "needs.json")], {
      GITHUB_REPOSITORY: "o/r",
      GITHUB_RUN_ID: "77",
      GITHUB_RUN_ATTEMPT: "2",
      GITHUB_EVENT_NAME: "push",
      GITHUB_REF: "refs/heads/main",
    });
    assert.equal(admit.status, 0, admit.stderr);
    writeFileSync(join(dir, "provenance.json"), admit.stdout);
    return { dir, provenance: join(dir, "provenance.json"), record: JSON.parse(admit.stdout) };
  };

  it("names the run that admitted the release", () => {
    const { record } = admitted();
    assert.deepEqual(record.run, {
      repository: "o/r",
      id: 77,
      attempt: 2,
      event: "push",
      ref: "refs/heads/main",
    });
  });

  it("fails the admission of a refused release, so the release job never opens", () => {
    const dir = mkdtempSync(join(tmpdir(), "wave-gate-"));
    const needs = healthy();
    needs["secret-scan"].result = "cancelled";
    writeFileSync(join(dir, "needs.json"), JSON.stringify(needs));
    const admit = run(["admit", join(dir, "needs.json")]);
    assert.notEqual(admit.status, 0);
    assert.equal(admit.stdout, "");
    assert.match(admit.stderr, /secret-scan did not succeed/);
  });

  it("signs only the APK the gate admitted", () => {
    const { dir, provenance } = admitted();
    assert.equal(run(["verify", provenance, join(dir, "unsigned.apk")]).status, 0);
    writeFileSync(join(dir, "other.apk"), "another apk");
    const other = run(["verify", provenance, join(dir, "other.apk")]);
    assert.notEqual(other.status, 0);
    assert.match(other.stderr, /not the APK/);
  });

  it("publishes only the over-the-air update the gate admitted", () => {
    const { dir, provenance } = admitted();
    assert.equal(run(["verify-update", provenance, join(dir, "update")]).status, 0);
    writeFileSync(join(dir, "update/bundles/android.hbc"), "another bundle");
    assert.notEqual(run(["verify-update", provenance, join(dir, "update")]).status, 0);
  });

  it("seals the record with the signed APK's digest for the release to carry", () => {
    const { dir, provenance, record } = admitted();
    writeFileSync(join(dir, "signed.apk"), "signed apk");
    const sealed = run(["seal", provenance, join(dir, "signed.apk")]);
    assert.equal(sealed.status, 0, sealed.stderr);
    const seal = JSON.parse(sealed.stdout);
    assert.equal(seal.artifact.signedSha256, sha256("signed apk"));
    assert.deepEqual(
      { ...seal, artifact: { ...seal.artifact, signedSha256: undefined } },
      {
        ...record,
        artifact: { ...record.artifact, signedSha256: undefined },
      },
    );
  });
});
