import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  gradleVersion,
  manifestMetaData,
  manifestVersion,
  withAppConfigVersion,
  withManifestMetaData,
  withManifestVersion,
} from "./apk-version.ts";

// A manifest aapt2 compiled at versionCode 503, versionName 0.5.3-ti, whose meta-data
// value is the same string as the versionName.
const manifest = readFileSync(new URL("./fixtures/AndroidManifest-0.5.3-ti.axml", import.meta.url));

describe("manifestVersion", () => {
  it("reads versionCode and versionName from a compiled AndroidManifest.xml", () => {
    assert.deepEqual(manifestVersion(manifest), { versionCode: 503, versionName: "0.5.3-ti" });
  });
});

describe("withManifestMetaData", () => {
  const name = "dev.leoperez.wave.BUILT_AS";

  it("reads a <meta-data> value", () => {
    assert.equal(manifestMetaData(manifest, name), "0.5.3-ti");
  });

  it("sets a string, and leaves the app's version alone", () => {
    const patched = withManifestMetaData(manifest, { [name]: "apk-v1-abc" });
    assert.equal(manifestMetaData(patched, name), "apk-v1-abc");
    assert.deepEqual(manifestVersion(patched), { versionCode: 503, versionName: "0.5.3-ti" });
  });

  it("keeps a long value when stamping the version, as a kept build's signing certificate", () => {
    const certificate = `-----BEGIN CERTIFICATE-----\n${"A".repeat(1800)}\n-----END CERTIFICATE-----\n`;
    const signed = withManifestMetaData(manifest, { [name]: certificate });
    const stamped = withManifestVersion(signed, { versionCode: 504, versionName: "0.5.4-ti" });
    assert.equal(manifestMetaData(stamped, name), certificate);
  });

  it('sets a boolean, as aapt2 compiles android:value="true"', () => {
    assert.equal(manifestMetaData(withManifestMetaData(manifest, { [name]: true }), name), true);
    assert.equal(manifestMetaData(withManifestMetaData(manifest, { [name]: false }), name), false);
  });

  it("refuses a name the manifest doesn't have", () => {
    assert.throws(() => withManifestMetaData(manifest, { "no.such.name": "x" }), /no\.such\.name/);
  });
});

describe("withManifestVersion", () => {
  it("sets versionCode and versionName, whatever the old name's length", () => {
    for (const version of [
      { versionCode: 504, versionName: "0.5.4-ti" },
      { versionCode: 10203, versionName: "1.2.3" },
      { versionCode: 9999, versionName: "0.99.99-ti" },
    ]) {
      const patched = withManifestVersion(manifest, version);
      assert.deepEqual(manifestVersion(patched), version);
      assert.equal(patched.readUInt32LE(4), patched.length, "the file's size header");
    }
  });

  it("can set the version of a manifest it set before", () => {
    const once = withManifestVersion(manifest, { versionCode: 504, versionName: "0.5.4-ti" });
    const twice = withManifestVersion(once, { versionCode: 600, versionName: "0.6.0-ti" });
    assert.deepEqual(manifestVersion(twice), { versionCode: 600, versionName: "0.6.0-ti" });
  });

  it("leaves the input as it was", () => {
    const before = Buffer.from(manifest);
    withManifestVersion(manifest, { versionCode: 504, versionName: "0.5.4-ti" });
    assert.deepEqual(manifest, before);
  });
});

describe("gradleVersion", () => {
  it("reads the version prebuild wrote into app/build.gradle", () => {
    const gradle = [
      "    defaultConfig {",
      "        applicationId 'dev.leoperez.wave'",
      "        minSdkVersion rootProject.ext.minSdkVersion",
      "        versionCode 504",
      '        versionName "0.5.4-ti"',
      "    }",
    ].join("\n");
    assert.deepEqual(gradleVersion(gradle), { versionCode: 504, versionName: "0.5.4-ti" });
  });

  it("fails when app/build.gradle sets no version", () => {
    assert.throws(() => gradleVersion("android {}"), /versionCode/);
  });
});

describe("withAppConfigVersion", () => {
  it("sets the version and versionCode of Expo's embedded app config, and nothing else", () => {
    const config =
      '{"name":"Wave","version":"0.5.3-ti","android":{"package":"dev.leoperez.wave","versionCode":503},"extra":{"syncUrl":"https://example.test"}}';
    assert.equal(
      withAppConfigVersion(config, { versionCode: 504, versionName: "0.5.4-ti" }),
      '{"name":"Wave","version":"0.5.4-ti","android":{"package":"dev.leoperez.wave","versionCode":504},"extra":{"syncUrl":"https://example.test"}}',
    );
  });
});

describe("apk-version.ts", () => {
  it("sets the unpacked APK's version to app/build.gradle's and prints it as aapt2 shows it", () => {
    const dir = mkdtempSync(join(tmpdir(), "apk-version-"));
    mkdirSync(join(dir, "apk/assets"), { recursive: true });
    writeFileSync(join(dir, "apk/AndroidManifest.xml"), manifest);
    writeFileSync(
      join(dir, "apk/assets/app.config"),
      '{"version":"0.5.3-ti","android":{"versionCode":503}}',
    );
    writeFileSync(join(dir, "build.gradle"), 'versionCode 504\nversionName "0.5.4-ti"\n');
    const script = fileURLToPath(new URL("./apk-version.ts", import.meta.url));
    const output = execFileSync(
      process.execPath,
      [script, join(dir, "build.gradle"), join(dir, "apk")],
      {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      },
    );
    assert.equal(output, "versionCode='504' versionName='0.5.4-ti'\n");
    assert.deepEqual(manifestVersion(readFileSync(join(dir, "apk/AndroidManifest.xml"))), {
      versionCode: 504,
      versionName: "0.5.4-ti",
    });
    assert.equal(
      readFileSync(join(dir, "apk/assets/app.config"), "utf8"),
      '{"version":"0.5.4-ti","android":{"versionCode":504}}',
    );
  });
});
