import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { manifestMetaData } from "./apk-version.ts";
import {
  stampManifestSource,
  updateChannel,
  updateMetaData,
  withEmbeddedUpdate,
} from "./update-config.ts";

describe("updateChannel", () => {
  const cases: [string, string, string | null][] = [
    ["push", "refs/heads/main", "ti"],
    ["push", "refs/heads/ti", null],
    ["push", "refs/tags/v0.5.6-ti", "ti"],
    ["push", "refs/tags/v0.5.6", "main"],
    ["pull_request", "refs/pull/12/merge", null],
    ["push", "refs/heads/feat/887-js-ota-updates", null],
    // A promotion starts the tag's run by hand, since its token's tag push starts none.
    ["workflow_dispatch", "refs/tags/v0.5.6", "main"],
    ["workflow_dispatch", "refs/tags/v0.5.6-ti", "ti"],
    ["workflow_dispatch", "refs/heads/main", null],
  ];
  for (const [event, ref, channel] of cases) {
    it(`gives ${event} of ${ref} the channel ${channel}`, () => {
      assert.equal(updateChannel({ event, ref }), channel);
    });
  }
});

describe("updateMetaData", () => {
  it("turns updates on for a channel and names it in the request headers", () => {
    assert.deepEqual(updateMetaData("ti", "apk-v1-abc"), {
      "expo.modules.updates.ENABLED": true,
      "expo.modules.updates.EXPO_RUNTIME_VERSION": "apk-v1-abc",
      "expo.modules.updates.UPDATES_CONFIGURATION_REQUEST_HEADERS_KEY":
        '{"expo-channel-name":"ti","wave-update-pass":"none"}',
    });
  });

  it("turns updates off for a build with no channel", () => {
    assert.equal(updateMetaData(null, "apk-v1-abc")["expo.modules.updates.ENABLED"], false);
  });
});

describe("stampManifestSource", () => {
  // As prebuild writes it from app.config.ts's placeholders.
  const source = `<manifest><application>
    <meta-data android:name="expo.modules.updates.ENABLED" android:value="false"/>
    <meta-data android:name="expo.modules.updates.EXPO_RUNTIME_VERSION" android:value="@string/expo_runtime_version"/>
    <meta-data android:name="expo.modules.updates.UPDATES_CONFIGURATION_REQUEST_HEADERS_KEY" android:value="{&quot;expo-channel-name&quot;:&quot;none&quot;,&quot;wave-update-pass&quot;:&quot;none&quot;}"/>
  </application></manifest>`;

  it("writes the channel and runtime version over prebuild's placeholders", () => {
    const stamped = stampManifestSource(source, updateMetaData("main", "apk-v1-abc"));
    assert.match(stamped, /updates\.ENABLED" android:value="true"/);
    assert.match(stamped, /EXPO_RUNTIME_VERSION" android:value="apk-v1-abc"/);
    assert.ok(
      stamped.includes(
        'android:value="{&quot;expo-channel-name&quot;:&quot;main&quot;,&quot;wave-update-pass&quot;:&quot;none&quot;}"',
      ),
    );
  });

  it("leaves the signing certificate as prebuild wrote it", () => {
    const certificate = `<meta-data android:name="expo.modules.updates.CODE_SIGNING_CERTIFICATE" android:value="-----BEGIN CERTIFICATE-----&#xA;AAAA&#xA;-----END CERTIFICATE-----&#xA;"/>`;
    const signed = source.replace("</application>", `${certificate}</application>`);
    const stamped = stampManifestSource(signed, updateMetaData("main", "apk-v1-abc"));
    assert.ok(stamped.includes(certificate));
  });

  it("refuses a manifest prebuild wrote no updates entry into", () => {
    assert.throws(
      () => stampManifestSource("<manifest/>", updateMetaData("ti", "x")),
      /updates\.ENABLED/,
    );
  });
});

it("preserves the pass placeholder when stamping an unpacked APK for a different channel", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "wave-update-config-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const manifestPath = join(dir, "AndroidManifest.xml");
  // aapt2-compiled manifest with the three update metadata entries for the ti channel.
  const fixture = new URL("./fixtures/AndroidManifest-updates.axml", import.meta.url);
  writeFileSync(manifestPath, readFileSync(fixture));
  mkdirSync(join(dir, "assets"));
  writeFileSync(join(dir, "assets/app.manifest"), "{}");
  const script = fileURLToPath(new URL("./update-config.ts", import.meta.url));
  execFileSync(process.execPath, [script, "stamp-apk", dir], {
    env: { ...process.env, WAVE_UPDATE_CHANNEL: "main", WAVE_RUNTIME_VERSION: "apk-v1-abc" },
  });
  const metadata = manifestMetaData(
    readFileSync(manifestPath),
    "expo.modules.updates.UPDATES_CONFIGURATION_REQUEST_HEADERS_KEY",
  );
  assert.deepEqual(JSON.parse(String(metadata)), {
    "expo-channel-name": "main",
    "wave-update-pass": "none",
  });
});

describe("withEmbeddedUpdate", () => {
  it("gives a repacked APK's JS its own identity and keeps the asset list", () => {
    const kept = JSON.stringify({ id: "old", commitTime: 1, assets: [{ name: "a" }] });
    assert.deepEqual(JSON.parse(withEmbeddedUpdate(kept, { id: "new", commitTime: 2 })), {
      id: "new",
      commitTime: 2,
      assets: [{ name: "a" }],
    });
  });
});
