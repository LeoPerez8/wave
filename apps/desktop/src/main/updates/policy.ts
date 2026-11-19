import type { KeyObject } from "node:crypto";
import { stat } from "node:fs/promises";
import {
  compareDesktopVersions,
  type DesktopChannel,
  type DesktopManifest,
  type DesktopPlatform,
} from "../../../../updates/src/desktopProtocol.ts";
import {
  desktopFileDigest,
  verifiedDesktopUpdate,
} from "../../../../updates/src/desktopSignature.ts";

export const authorizeUpdate = (
  signed: unknown,
  key: KeyObject,
  channel: DesktopChannel,
  platform: DesktopPlatform,
  version: string,
  builtAt: number,
  accepted: number,
): DesktopManifest | null => {
  const manifest = verifiedDesktopUpdate(signed, key, channel, platform);
  const order = compareDesktopVersions(manifest.version, version);
  if (manifest.serial < accepted || order === 0) return null;
  return order > 0 || (manifest.rollback && manifest.serial > builtAt) ? manifest : null;
};

export const verifyInstaller = async (file: string, manifest: DesktopManifest): Promise<void> => {
  const info = await stat(file);
  if (
    !info.isFile() ||
    info.size !== manifest.size ||
    (await desktopFileDigest(file)) !== manifest.sha512
  ) {
    throw new Error("Desktop installer does not match the signed manifest");
  }
};
