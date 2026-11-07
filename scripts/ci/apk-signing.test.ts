import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

// unsigned-apk.sh and sign-apk.sh need Android's build tools and a JDK's keytool. CI's runners have both; a
// machine without them skips these tests.
const androidHome = [process.env.ANDROID_HOME, join(homedir(), "Android/Sdk")].find(
  (dir) => dir && existsSync(join(dir, "build-tools")),
);
const buildTools =
  androidHome &&
  readdirSync(join(androidHome, "build-tools"))
    .toSorted((a, b) => a.localeCompare(b, undefined, { numeric: true }))
    .map((version) => join(androidHome, "build-tools", version))
    .findLast((dir) => existsSync(join(dir, "apksigner")));
const hasKeytool = spawnSync("keytool", ["-help"]).status === 0;
const skip = !buildTools || !hasKeytool ? "needs Android build tools and keytool" : false;

const script = fileURLToPath(new URL("./sign-apk.sh", import.meta.url));
const unsign = fileURLToPath(new URL("./unsigned-apk.sh", import.meta.url));
const manifest = fileURLToPath(
  new URL("./fixtures/AndroidManifest-0.5.3-ti.axml", import.meta.url),
);

// Each test's keys and APKs, removed once the tests end.
const scratch = (prefix: string) => {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
};

const apksigner = (...args: string[]) =>
  execFileSync(join(buildTools || "", "apksigner"), args, { encoding: "utf8" });

/** A throwaway PKCS12 key in `dir`, with its certificate's SHA-256. */
const key = (dir: string, name: string, password: string) => {
  const keystore = join(dir, `${name}.p12`);
  execFileSync("keytool", [
    "-genkeypair",
    "-keystore",
    keystore,
    "-storetype",
    "PKCS12",
    "-storepass",
    password,
    "-keypass",
    password,
    "-alias",
    name,
    "-keyalg",
    "RSA",
    "-keysize",
    "2048",
    "-validity",
    "2",
    "-dname",
    `CN=${name}`,
  ]);
  const certificate = execFileSync("keytool", [
    "-exportcert",
    "-rfc",
    "-keystore",
    keystore,
    "-storepass",
    password,
    "-alias",
    name,
  ]);
  const der = Buffer.from(certificate.toString().replace(/-----[^-]+-----|\s/g, ""), "base64");
  const sha256 = execFileSync("sha256sum", { input: der, encoding: "utf8" }).split(" ")[0] ?? "";
  return { keystore, alias: name, password, sha256 };
};
type Key = ReturnType<typeof key>;

/** A rotation proof from `older` to `newer`, as ticket 14's: the older key loses rollback. */
const lineage = (dir: string, older: Key, newer: Key, rollback = false) => {
  const out = join(dir, `${older.alias}-to-${newer.alias}.lineage`);
  apksigner(
    "rotate",
    "--out",
    out,
    "--old-signer",
    "--ks",
    older.keystore,
    "--ks-key-alias",
    older.alias,
    "--ks-pass",
    `pass:${older.password}`,
    "--set-rollback",
    String(rollback),
    "--new-signer",
    "--ks",
    newer.keystore,
    "--ks-key-alias",
    newer.alias,
    "--ks-pass",
    `pass:${newer.password}`,
  );
  return out;
};

/** An unsigned APK: Wave's compiled manifest (minSdk 31) and a placeholder dex. */
const unsignedApk = (dir: string) => {
  const contents = join(dir, "apk");
  mkdirSync(contents);
  copyFileSync(manifest, join(contents, "AndroidManifest.xml"));
  execFileSync("sh", ["-c", "printf dex > classes.dex && zip -q -X ../unsigned.apk *"], {
    cwd: contents,
  });
  return join(dir, "unsigned.apk");
};

/** Runs sign-apk.sh with the release key, its proof and the signers it must find. */
const sign = (
  dir: string,
  input: string,
  {
    release,
    proof,
    expectedRelease = release.sha256,
    expectedPrevious,
    secrets = {},
  }: {
    release: Key;
    proof: string;
    expectedRelease?: string;
    expectedPrevious: string;
    secrets?: Record<string, string | undefined>;
  },
) => {
  const output = join(dir, "signed.apk");
  const keys = mkdtempSync(join(dir, "tmp-"));
  const env: Record<string, string | undefined> = {
    ...process.env,
    ANDROID_HOME: androidHome,
    TMPDIR: keys,
    WAVE_RELEASE_KEYSTORE: readFileSync(release.keystore).toString("base64"),
    WAVE_RELEASE_KEYSTORE_PASSWORD: release.password,
    WAVE_SIGNING_LINEAGE: readFileSync(proof).toString("base64"),
    WAVE_RELEASE_SIGNER_SHA256: expectedRelease,
    WAVE_PREVIOUS_SIGNER_SHA256: expectedPrevious,
    ...secrets,
  };
  for (const name of Object.keys(env)) if (env[name] === undefined) delete env[name];
  const run = spawnSync("bash", [script, input, output], { env, encoding: "utf8" });
  return { ...run, output, keysLeft: readdirSync(keys) };
};

describe("sign-apk.sh", { skip }, () => {
  const setup = () => {
    const dir = scratch("wave-sign-");
    const previous = key(dir, "previous", "previous-pass");
    const release = key(dir, "wave", "release-pass");
    return { dir, previous, release, proof: lineage(dir, previous, release) };
  };

  it("signs with the release key alone and carries the rotation proof", () => {
    const { dir, previous, release, proof } = setup();
    const run = sign(dir, unsignedApk(dir), {
      release,
      proof,
      expectedPrevious: previous.sha256,
    });
    assert.equal(run.status, 0, run.stderr);
    const verified = apksigner("verify", "-v", "--print-certs", run.output);
    assert.match(verified, /Verified using v3 scheme \(APK Signature Scheme v3\): true/);
    assert.match(verified, /Number of signers: 1/);
    assert.match(
      verified,
      new RegExp(`V3\\.0 Signer: certificate SHA-256 digest: ${release.sha256}`),
    );
    const proven = apksigner("lineage", "--in", run.output, "--print-certs");
    assert.match(
      proven,
      new RegExp(`Signer #1 in lineage certificate SHA-256 digest: ${previous.sha256}`),
    );
    assert.match(
      proven,
      new RegExp(`Signer #2 in lineage certificate SHA-256 digest: ${release.sha256}`),
    );
    assert.match(proven, /Has rollback capability {6}: false/);
    assert.deepEqual(run.keysLeft, [], "no key or proof is left on disk");
  });

  it("refuses a keystore that isn't the release key, and leaves no APK", () => {
    const { dir, previous, release, proof } = setup();
    const other = key(dir, "other", "other-pass");
    const run = sign(dir, unsignedApk(dir), {
      release,
      proof,
      expectedRelease: other.sha256,
      expectedPrevious: previous.sha256,
    });
    assert.notEqual(run.status, 0);
    assert.match(run.stderr, /isn't signed by the release key/);
    assert.equal(existsSync(run.output), false);
    assert.deepEqual(run.keysLeft, []);
  });

  it("refuses a rotation proof that doesn't start at the previous key", () => {
    const { dir, release } = setup();
    const stranger = key(dir, "stranger", "stranger-pass");
    const actualPrevious = key(dir, "actual", "actual-pass");
    const run = sign(dir, unsignedApk(dir), {
      release,
      proof: lineage(dir, stranger, release),
      expectedPrevious: actualPrevious.sha256,
    });
    assert.notEqual(run.status, 0);
    assert.match(run.stderr, /rotation proof doesn't go from the previous key to the release key/);
    assert.equal(existsSync(run.output), false);
  });

  it("refuses a rotation proof that lets the previous key roll back", () => {
    const { dir, previous, release } = setup();
    const run = sign(dir, unsignedApk(dir), {
      release,
      proof: lineage(dir, previous, release, true),
      expectedPrevious: previous.sha256,
    });
    assert.notEqual(run.status, 0);
    assert.match(run.stderr, /previous key can still roll back/);
    assert.equal(existsSync(run.output), false);
  });

  it("says which secret is missing", () => {
    const { dir, previous, release, proof } = setup();
    const run = sign(dir, unsignedApk(dir), {
      release,
      proof,
      expectedPrevious: previous.sha256,
      secrets: { WAVE_SIGNING_LINEAGE: undefined },
    });
    assert.notEqual(run.status, 0);
    assert.match(run.stderr, /WAVE_SIGNING_LINEAGE/);
    assert.equal(existsSync(run.output), false);
  });

  it("pins Wave's release key and the public key before it", () => {
    const pinned = readFileSync(script, "utf8");
    // ticket 14's key, CN=Wave, O=Wave.
    assert.match(pinned, /80cee0c33afc558f4b130433c78035bba0f966f1c8f0fce422f587e245fcde65/);
    // Expo's debug key, which signed every release up to v0.58.0-ti.
    assert.match(pinned, /fac61745dc0903786fb9ede62a962b399f7348f0bb6f899b8332667591033b9c/);
  });
});

describe("unsigned-apk.sh", { skip }, () => {
  it("drops a build's signature, so only sign-apk.sh can make the APK installable", () => {
    const dir = scratch("wave-unsign-");
    const debug = key(dir, "androiddebugkey", "android");
    // Gradle's release output: signed with the debug key, v1 to v3.
    const built = join(dir, "app-release.apk");
    apksigner(
      "sign",
      "--v1-signing-enabled",
      "true",
      "--min-sdk-version",
      "24",
      "--ks",
      debug.keystore,
      "--ks-key-alias",
      debug.alias,
      "--ks-pass",
      "pass:android",
      "--out",
      built,
      unsignedApk(dir),
    );
    const output = join(dir, "unsigned.apk");
    const run = spawnSync("bash", [unsign, built, output], {
      env: { ...process.env, ANDROID_HOME: androidHome },
      encoding: "utf8",
    });
    assert.equal(run.status, 0, run.stderr);
    assert.notEqual(spawnSync(join(buildTools || "", "apksigner"), ["verify", output]).status, 0);
    const entries = execFileSync("unzip", ["-Z1", output], { encoding: "utf8" }).split("\n");
    assert.deepEqual(entries.filter(Boolean).toSorted(), ["AndroidManifest.xml", "classes.dex"]);
    const zipalign = join(buildTools || "", "zipalign");
    assert.equal(spawnSync(zipalign, ["-c", "-P", "16", "4", output]).status, 0, "stays aligned");
  });
});
