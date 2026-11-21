import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { test } from "node:test";
import { desktopKeyDigest, type DesktopEvidence } from "./desktopEvidence.ts";
import { artifactName, desktopLatestKey, desktopPublishedKey } from "./desktopProtocol.ts";
import { publishDesktop } from "./desktopPublish.ts";
import { verifiedDesktopUpdate } from "./desktopSignature.ts";
import { memoryStorage } from "./testing.ts";

test("desktop rollback republishes both verified installers under a fresh signed serial", async () => {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const bucket = { ...memoryStorage(), putFile: async () => {} };
  const proof = (version: string): DesktopEvidence => {
    const file = (name: string) => ({
      name,
      sha512: Buffer.alloc(64).toString("base64"),
      size: 123,
    });
    return {
      source: "a".repeat(40),
      tag: `v${version}`,
      publicKeySha256: desktopKeyDigest(publicKey),
      files: {
        win32: [file(artifactName("win32", version))],
        linux: [file(artifactName("linux", version))],
      },
    };
  };
  const v1 = proof("0.71.0-ti");
  const v2 = proof("0.72.0-ti");
  const publish = (release: DesktopEvidence, rollback: boolean) =>
    publishDesktop({
      proof: release,
      root: ".",
      bucket,
      signingKey: privateKey,
      channel: "ti",
      rollback,
      now: () => 100,
    });
  await publish(v1, false);
  await publish(v2, false);
  const before = await bucket.read(desktopLatestKey("ti"));
  const target = await bucket.read(desktopPublishedKey("ti", "0.71.0-ti"));
  await bucket.put(desktopPublishedKey("ti", "0.71.0-ti"), "{}", "application/json");
  await assert.rejects(publish(v1, true), /signature/);
  assert.equal(await bucket.read(desktopLatestKey("ti")), before);
  await bucket.put(desktopPublishedKey("ti", "0.71.0-ti"), target!, "application/json");
  await publish(v1, true);

  const latest = JSON.parse((await bucket.read(desktopLatestKey("ti")))!);
  for (const platform of ["win32", "linux"] as const) {
    const manifest = verifiedDesktopUpdate(latest[platform], publicKey, "ti", platform);
    assert.equal(manifest.version, "0.71.0-ti");
    assert.equal(manifest.rollback, true);
    assert.equal(manifest.serial, 102);
  }
  await publish(v2, false);
  assert.deepEqual(JSON.parse((await bucket.read(desktopLatestKey("ti")))!), latest);
});

test("desktop rollback leaves the phone's update, history and pointers as they were", async () => {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const bucket = { ...memoryStorage(), putFile: async () => {} };
  // What the phone's releases keep beside the desktop's (layout.ts).
  const phone = {
    "updates/ti/history.json": '[{"id":"a"}]',
    "updates/ti/native-a/latest.json": '{"updateId":"a"}',
    "assets/bundle-a": "bundle",
    "apks/ti/latest.json": '{"version":"0.72.0-ti"}',
    "notes/ti.json": "[]",
  };
  for (const [key, value] of Object.entries(phone))
    await bucket.put(key, value, "application/json");
  const proof = (version: string): DesktopEvidence => ({
    source: "a".repeat(40),
    tag: `v${version}`,
    publicKeySha256: desktopKeyDigest(publicKey),
    files: {
      win32: [
        {
          name: artifactName("win32", version),
          sha512: Buffer.alloc(64).toString("base64"),
          size: 1,
        },
      ],
      linux: [
        {
          name: artifactName("linux", version),
          sha512: Buffer.alloc(64).toString("base64"),
          size: 1,
        },
      ],
    },
  });
  const publish = (version: string, rollback: boolean) =>
    publishDesktop({
      proof: proof(version),
      root: ".",
      bucket,
      signingKey: privateKey,
      channel: "ti",
      rollback,
      now: () => 100,
    });
  await publish("0.71.0-ti", false);
  await publish("0.72.0-ti", false);
  await publish("0.71.0-ti", true);

  const { objects } = await bucket.list({ prefix: "" });
  const kept = objects.map(({ key }) => key).filter((key) => !key.startsWith("desktop/"));
  assert.deepEqual(kept.toSorted(), Object.keys(phone).toSorted());
  for (const [key, value] of Object.entries(phone)) assert.equal(await bucket.read(key), value);
});
