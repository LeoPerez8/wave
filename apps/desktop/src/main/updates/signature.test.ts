import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { test } from "node:test";
import { artifactName } from "../../../../updates/src/desktopProtocol.ts";
import {
  signDesktopUpdate,
  verifiedDesktopUpdate,
} from "../../../../updates/src/desktopSignature.ts";

const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const manifest = {
  channel: "ti",
  platform: "win32",
  version: "0.71.0-ti",
  serial: 12,
  rollback: false,
  sha512: Buffer.alloc(64).toString("base64"),
  size: 123,
} as const;

test("only a Wave-signed manifest for the installed platform and channel can authorize a download", () => {
  const signed = signDesktopUpdate(manifest, privateKey);
  assert.deepEqual(verifiedDesktopUpdate(signed, publicKey, "ti", "win32"), manifest);
  assert.throws(() =>
    verifiedDesktopUpdate({ ...signed, signature: "" }, publicKey, "ti", "win32"),
  );
  assert.throws(() =>
    verifiedDesktopUpdate(
      { ...signed, payload: signed.payload.replace("0.71", "0.72") },
      publicKey,
      "ti",
      "win32",
    ),
  );
  assert.throws(() => verifiedDesktopUpdate(signed, publicKey, "main", "win32"));
  assert.throws(() => verifiedDesktopUpdate(signed, publicKey, "ti", "linux"));
  assert.equal(artifactName("win32", "0.71.0-ti"), "wave-0.71.0-ti-win-x64.exe");
});
