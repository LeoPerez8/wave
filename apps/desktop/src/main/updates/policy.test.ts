import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { desktopFileDigest, signDesktopUpdate } from "../../../../updates/src/desktopSignature.ts";
import { authorizeUpdate, verifyInstaller } from "./policy.ts";

test("only an explicit, fresh signed rollback may downgrade and changed installer bytes are refused", async () => {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const dir = await mkdtemp(join(tmpdir(), "wave-update-"));
  try {
    const file = join(dir, "Wave.AppImage");
    await writeFile(file, "installer");
    const manifest = {
      channel: "ti",
      platform: "linux",
      version: "0.71.0-ti",
      serial: 30,
      rollback: false,
      sha512: await desktopFileDigest(file),
      size: 9,
    } as const;
    const check = (rollback: boolean, floor: number) =>
      authorizeUpdate(
        signDesktopUpdate({ ...manifest, rollback }, privateKey),
        publicKey,
        "ti",
        "linux",
        "0.72.0-ti",
        20,
        floor,
      );
    assert.equal(check(false, 0), null);
    assert.equal(check(true, 31), null);
    const admitted = check(true, 29);
    assert.ok(admitted);
    await verifyInstaller(file, admitted);
    await writeFile(file, "tampering");
    await assert.rejects(verifyInstaller(file, admitted), /does not match/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
