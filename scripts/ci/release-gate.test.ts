import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { admitRelease, desktopPromotion, verifyDesktopPublished } from "./release-gate.ts";

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

  it("admits the phone independently when desktop checks fail", () => {
    const needs = { ...healthy(), desktop: { result: "failure", outputs: {} } };
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

describe("a promotion's admission", () => {
  /** The sealed record the ti release v1.3.0-ti carries on its GitHub Release. */
  const tiRecord = (overrides: Record<string, unknown> = {}) => {
    const record = admitRelease(healthy(), {
      repository: "o/r",
      id: 70,
      attempt: 1,
      event: "push",
      ref: "refs/heads/main",
    });
    return {
      ...record,
      artifact: { ...record.artifact, signedSha256: "5".repeat(64) },
      ...overrides,
    };
  };
  const stable = () => {
    const needs = healthy();
    needs.checks.outputs.release_tag = "v1.3.0";
    needs.android.outputs.update_channel = "main";
    return needs;
  };

  it("links the stable release to the tested ti release of the same source", () => {
    const provenance = admitRelease(stable(), undefined, tiRecord());
    assert.deepEqual(provenance.promotedFrom, {
      releaseTag: "v1.3.0-ti",
      source: SOURCE,
      run: { repository: "o/r", id: 70, attempt: 1 },
      signedSha256: "5".repeat(64),
    });
  });

  it("refuses a stable release with no sealed record of its ti release", () => {
    assert.throws(() => admitRelease(stable()), /v1\.3\.0-ti/);
    assert.throws(() => admitRelease(stable(), undefined, {}), /v1\.3\.0-ti/);
    const unsealed = tiRecord();
    delete (unsealed.artifact as { signedSha256?: string }).signedSha256;
    assert.throws(() => admitRelease(stable(), undefined, unsealed), /sealed/);
  });

  it("refuses a ti record of another source or another version", () => {
    assert.throws(
      () => admitRelease(stable(), undefined, tiRecord({ source: EVENT })),
      new RegExp(EVENT.slice(0, 7)),
    );
    assert.throws(
      () => admitRelease(stable(), undefined, tiRecord({ releaseTag: "v1.2.9-ti" })),
      /v1\.2\.9-ti/,
    );
  });

  it("links an older ti release when the promotion names it, as for an app it skipped", () => {
    const older = tiRecord({ releaseTag: "v1.2.9-ti" });
    const provenance = admitRelease(stable(), undefined, older, "v1.2.9-ti");
    assert.equal(provenance.promotedFrom?.releaseTag, "v1.2.9-ti");
    assert.throws(() => admitRelease(stable(), undefined, older, "v1.2.8-ti"), /v1\.2\.8-ti/);
  });

  it("refuses to promote a ti release above the stable version, or a stable one", () => {
    const newer = tiRecord({ releaseTag: "v1.3.1-ti" });
    assert.throws(() => admitRelease(stable(), undefined, newer, "v1.3.1-ti"), /above v1\.3\.0/);
    const promoted = tiRecord({ releaseTag: "v1.2.0" });
    assert.throws(() => admitRelease(stable(), undefined, promoted, "v1.2.0"), /-ti release/);
  });

  it("leaves ti releases as they were, with nothing to link", () => {
    assert.equal(admitRelease(healthy()).promotedFrom, undefined);
  });

  it("reads the ti record from the file the gate job fetched, or refuses without one", () => {
    const dir = mkdtempSync(join(tmpdir(), "wave-gate-"));
    writeFileSync(join(dir, "needs.json"), JSON.stringify(stable()));
    writeFileSync(join(dir, "ti.json"), JSON.stringify(tiRecord()));
    const admitted = run(["admit", join(dir, "needs.json"), join(dir, "ti.json")]);
    assert.equal(admitted.status, 0, admitted.stderr);
    assert.equal(JSON.parse(admitted.stdout).promotedFrom.releaseTag, "v1.3.0-ti");
    const missing = run(["admit", join(dir, "needs.json"), join(dir, "absent.json")]);
    assert.notEqual(missing.status, 0);
    assert.equal(missing.stdout, "");
  });

  it("takes the ti release the promotion names from the command line", () => {
    const dir = mkdtempSync(join(tmpdir(), "wave-gate-"));
    writeFileSync(join(dir, "needs.json"), JSON.stringify(stable()));
    writeFileSync(join(dir, "ti.json"), JSON.stringify(tiRecord({ releaseTag: "v1.2.9-ti" })));
    const admitted = run(["admit", join(dir, "needs.json"), join(dir, "ti.json"), "v1.2.9-ti"]);
    assert.equal(admitted.status, 0, admitted.stderr);
    assert.equal(JSON.parse(admitted.stdout).promotedFrom.releaseTag, "v1.2.9-ti");
  });
});

/** The desktop's record as its release job publishes it beside the installers. */
const desktopRecord = (tag: string, source = SOURCE, overrides: Record<string, unknown> = {}) => ({
  schema: "wave-release-provenance/1",
  source,
  releaseTag: tag,
  desktop: { tag, source, platforms: {} },
  ...overrides,
});

describe("a desktop promotion", () => {
  it("links the stable desktop to the ti release it is built from", () => {
    assert.deepEqual(
      desktopPromotion(desktopRecord("v1.2.9-ti"), {
        tiTag: "v1.2.9-ti",
        stableTag: "v1.3.0",
        source: SOURCE,
      }),
      { releaseTag: "v1.2.9-ti", source: SOURCE },
    );
  });

  it("refuses a record of another release or source, or one that admitted no desktop", () => {
    const promote = (value: unknown, tiTag = "v1.2.9-ti") =>
      desktopPromotion(value, { tiTag, stableTag: "v1.3.0", source: SOURCE });
    assert.throws(() => promote(undefined), /no desktop record/);
    assert.throws(() => promote(desktopRecord("v1.2.8-ti")), /v1\.2\.8-ti/);
    assert.throws(() => promote(desktopRecord("v1.2.9-ti", EVENT)), new RegExp(EVENT.slice(0, 7)));
    assert.throws(
      () => promote(desktopRecord("v1.2.9-ti", SOURCE, { desktop: undefined })),
      /admitted no desktop/,
    );
    assert.throws(() => promote(desktopRecord("v1.3.1-ti"), "v1.3.1-ti"), /above v1\.3\.0/);
  });

  it("prints the link from the command line", () => {
    const dir = mkdtempSync(join(tmpdir(), "wave-gate-"));
    writeFileSync(join(dir, "ti.json"), JSON.stringify(desktopRecord("v1.2.9-ti")));
    const linked = run(["promote-desktop", join(dir, "ti.json"), "v1.2.9-ti", "v1.3.0", SOURCE]);
    assert.equal(linked.status, 0, linked.stderr);
    assert.deepEqual(JSON.parse(linked.stdout), { releaseTag: "v1.2.9-ti", source: SOURCE });
  });
});

describe("a published desktop record", () => {
  it("holds for its own tag and the tag's commit", () => {
    const record = desktopRecord("v1.3.0-ti");
    assert.equal(verifyDesktopPublished(record, { tag: "v1.3.0-ti", commit: SOURCE }), record);
  });

  it("holds for a stable release built from the ti release it links", () => {
    const record = desktopRecord("v1.3.0", SOURCE, {
      promotedFrom: { releaseTag: "v1.2.9-ti", source: SOURCE },
    });
    const checked = { tag: "v1.3.0", commit: EVENT, promotedCommit: SOURCE };
    assert.equal(verifyDesktopPublished(record, checked), record);
    assert.throws(
      () => verifyDesktopPublished(record, { ...checked, promotedCommit: EVENT }),
      /v1\.2\.9-ti is on/,
    );
    assert.throws(
      () => verifyDesktopPublished(record, { tag: "v1.3.0", commit: EVENT }),
      new RegExp(EVENT.slice(0, 7)),
    );
  });

  it("fails for another tag or commit, or without the desktop's admission", () => {
    const record = desktopRecord("v1.3.0-ti");
    assert.throws(
      () => verifyDesktopPublished(record, { tag: "v1.3.1-ti", commit: SOURCE }),
      /v1\.3\.1-ti/,
    );
    assert.throws(
      () => verifyDesktopPublished(record, { tag: "v1.3.0-ti", commit: EVENT }),
      new RegExp(EVENT.slice(0, 7)),
    );
    assert.throws(
      () =>
        verifyDesktopPublished(
          { ...record, desktop: undefined },
          { tag: "v1.3.0-ti", commit: SOURCE },
        ),
      /admitted no desktop/,
    );
    assert.throws(
      () => verifyDesktopPublished(undefined, { tag: "v1.3.0-ti", commit: SOURCE }),
      /no desktop record/,
    );
  });

  it("checks a downloaded record from the command line", () => {
    const dir = mkdtempSync(join(tmpdir(), "wave-gate-"));
    writeFileSync(join(dir, "record.json"), JSON.stringify(desktopRecord("v1.3.0-ti")));
    const checked = run(["verify-desktop-release", join(dir, "record.json"), "v1.3.0-ti", SOURCE]);
    assert.equal(checked.status, 0, checked.stderr);
    const refused = run(["verify-desktop-release", join(dir, "record.json"), "v1.3.0-ti", EVENT]);
    assert.notEqual(refused.status, 0);
  });
});

describe("a published release's record", () => {
  /** v1.3.0-ti as its GitHub Release holds it: the sealed record and the signed APK. */
  const published = () => {
    const dir = mkdtempSync(join(tmpdir(), "wave-published-"));
    const record = admitRelease(healthy());
    writeFileSync(join(dir, "wave-1.3.0-ti.apk"), "signed apk");
    const signedSha256 = createHash("sha256").update("signed apk").digest("hex");
    const write = (value: unknown) =>
      writeFileSync(join(dir, "record.json"), JSON.stringify(value));
    write({ ...record, artifact: { ...record.artifact, signedSha256 } });
    const verify = (tag = "v1.3.0-ti", commit = SOURCE) =>
      run([
        "verify-release",
        join(dir, "record.json"),
        tag,
        commit,
        join(dir, "wave-1.3.0-ti.apk"),
      ]);
    return { dir, record, signedSha256, write, verify };
  };

  it("holds for the release's own tag, commit and APK", () => {
    const { verify } = published();
    const checked = verify();
    assert.equal(checked.status, 0, checked.stderr);
  });

  it("fails for another tag or commit", () => {
    const { verify } = published();
    assert.match(verify("v1.3.1-ti").stderr, /v1\.3\.1-ti/);
    assert.match(verify("v1.3.0-ti", EVENT).stderr, new RegExp(EVENT.slice(0, 7)));
    assert.notEqual(verify("v1.3.0-ti", EVENT).status, 0);
  });

  it("fails, saying so, when the record's source isn't a commit", () => {
    const { record, signedSha256, write, verify } = published();
    for (const source of [undefined, 42, ["x"], SOURCE.toUpperCase(), `${SOURCE}\n`]) {
      write({ ...record, source, artifact: { ...record.artifact, signedSha256 } });
      const checked = verify();
      assert.notEqual(checked.status, 0, String(source));
      assert.match(checked.stderr, /v1\.3\.0-ti is on .*, but its record names no commit\./);
      assert.doesNotMatch(checked.stderr, /TypeError/);
    }
  });

  it("fails when the APK isn't the one the record sealed, or the record isn't sealed", () => {
    const { dir, record, write, verify } = published();
    writeFileSync(join(dir, "wave-1.3.0-ti.apk"), "another apk");
    assert.match(verify().stderr, /APK/);
    write(record);
    assert.match(verify().stderr, /sealed/);
  });

  it("fails without a record, as for a release published before the gate", () => {
    const { dir } = published();
    const missing = run(["verify-release", join(dir, "absent.json"), "v1.3.0-ti", SOURCE]);
    assert.notEqual(missing.status, 0);
    assert.match(missing.stderr, /no provenance record/);
  });
});
