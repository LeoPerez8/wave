import { createHash, sign, verify, type KeyObject } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  desktopVersion,
  type DesktopChannel,
  type DesktopManifest,
  type DesktopPlatform,
  type SignedDesktopUpdate,
} from "./desktopProtocol.ts";

export const signDesktopUpdate = (
  manifest: DesktopManifest,
  key: KeyObject,
): SignedDesktopUpdate => {
  if (key.asymmetricKeyType !== "ed25519") throw new Error("Expected an Ed25519 signing key");
  const payload = JSON.stringify(manifest);
  return { payload, signature: sign(null, Buffer.from(payload), key).toString("base64") };
};

export const verifiedDesktopUpdate = (
  signed: unknown,
  key: KeyObject,
  channel: DesktopChannel,
  platform: DesktopPlatform,
): DesktopManifest => {
  const { payload, signature } = (signed ?? {}) as Partial<SignedDesktopUpdate>;
  if (
    key.asymmetricKeyType !== "ed25519" ||
    typeof payload !== "string" ||
    payload.length > 1024 ||
    typeof signature !== "string" ||
    !/^[A-Za-z0-9+/]{86}==$/.test(signature) ||
    !verify(null, Buffer.from(payload), key, Buffer.from(signature, "base64"))
  ) {
    throw new Error("Desktop update signature is invalid");
  }
  const manifest = JSON.parse(payload) as DesktopManifest;
  if (
    !manifest ||
    manifest.channel !== channel ||
    manifest.platform !== platform ||
    typeof manifest.version !== "string" ||
    !desktopVersion(manifest.version, channel) ||
    !Number.isSafeInteger(manifest.serial) ||
    manifest.serial <= 0 ||
    typeof manifest.rollback !== "boolean" ||
    typeof manifest.sha512 !== "string" ||
    !/^[A-Za-z0-9+/]{86}==$/.test(manifest.sha512) ||
    !Number.isSafeInteger(manifest.size) ||
    manifest.size <= 0
  ) {
    throw new Error("Desktop update manifest is invalid");
  }
  return manifest;
};

export const desktopFileDigest = async (path: string): Promise<string> => {
  const hash = createHash("sha512");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("base64");
};
