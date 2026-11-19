import { createPublicKey, type KeyObject } from "node:crypto";
import { join } from "node:path";
import {
  compareDesktopVersions,
  desktopFileKey,
  desktopHistoryKey,
  desktopLatestKey,
  desktopPlatforms,
  desktopPublishedKey,
  desktopVersion,
  type DesktopChannel,
  type SignedDesktopUpdate,
} from "./desktopProtocol.ts";
import { desktopArtifact, desktopKeyDigest, type DesktopEvidence } from "./desktopEvidence.ts";
import { signDesktopUpdate, verifiedDesktopUpdate } from "./desktopSignature.ts";
import type { UpdateBucket } from "./release.ts";

export type DesktopBucket = UpdateBucket & {
  readonly putFile: (key: string, path: string, contentType: string) => Promise<void>;
};

// Both platforms move together. The channel pointer is written only after everything it names.
export const publishDesktop = async ({
  proof,
  root,
  rollback,
  channel,
  bucket,
  signingKey,
  notes = { en: { new: [], fixes: [] } },
  now = Date.now,
}: {
  proof: DesktopEvidence;
  root: string;
  rollback: boolean;
  channel: DesktopChannel;
  bucket: DesktopBucket;
  signingKey: KeyObject;
  notes?: unknown;
  now?: () => number;
}): Promise<boolean> => {
  if (desktopKeyDigest(signingKey) !== proof.publicKeySha256) {
    throw new Error(
      "Desktop signing key does not match the public key admitted for these installers",
    );
  }
  const publicKey = createPublicKey(signingKey);
  const version = proof.tag.slice(1);
  if (!desktopVersion(version, channel)) {
    throw new Error("Desktop rollback cannot cross channels");
  }
  const readJson = async (key: string) => JSON.parse((await bucket.read(key)) ?? "null");
  const putJson = (key: string, value: unknown) =>
    bucket.put(key, Buffer.from(JSON.stringify(value)), "application/json");
  const latest = await readJson(desktopLatestKey(channel));
  const current = latest && verifiedDesktopUpdate(latest.win32, publicKey, channel, "win32");
  const highest = latest?.highestVersion ?? current?.version ?? version;
  if (typeof highest !== "string" || !desktopVersion(highest, channel))
    throw new Error("Invalid desktop release history");
  if (
    !rollback &&
    (compareDesktopVersions(version, highest) < 0 || (current?.rollback && version === highest))
  ) {
    return false;
  }
  if (rollback && (!current || compareDesktopVersions(version, current.version) >= 0)) {
    throw new Error("Desktop rollback requires an earlier release on this channel");
  }

  const publishedKey = desktopPublishedKey(channel, version);
  const published = rollback ? await readJson(publishedKey) : null;
  const serial = Math.max(now(), (current?.serial ?? 0) + 1);
  const signed: Partial<Record<(typeof desktopPlatforms)[number], SignedDesktopUpdate>> = {};
  for (const platform of desktopPlatforms) {
    const [installer, blockmap] = proof.files[platform];
    if (!installer) throw new Error("Installer evidence is missing");
    if (rollback) {
      const held = verifiedDesktopUpdate(published?.[platform], publicKey, channel, platform);
      if (
        held.rollback ||
        held.version !== version ||
        held.sha512 !== installer.sha512 ||
        held.size !== installer.size
      ) {
        throw new Error("Desktop rollback target differs from the original signed publication");
      }
    }
    signed[platform] = signDesktopUpdate(
      {
        channel,
        platform,
        version,
        serial,
        rollback,
        sha512: installer.sha512,
        size: installer.size,
      },
      signingKey,
    );
    const from = rollback ? root : join(root, desktopArtifact(platform));
    await bucket.putFile(
      desktopFileKey(
        channel,
        version,
        installer.name,
        Buffer.from(installer.sha512, "base64").toString("hex"),
      ),
      join(from, installer.name),
      "application/octet-stream",
    );
    if (blockmap)
      await bucket.putFile(
        desktopFileKey(channel, version, blockmap.name),
        join(from, blockmap.name),
        "application/octet-stream",
      );
  }
  if (!rollback) {
    await putJson(publishedKey, signed);
    const historyKey = desktopHistoryKey(channel);
    const history = await readJson(historyKey);
    const kept = (history?.releases ?? []) as { version: string; date: string }[];
    const existing = kept.find((entry) => entry.version === version);
    const release = { version, date: existing?.date ?? new Date(serial).toISOString(), notes };
    await putJson(historyKey, {
      releases: [release, ...kept.filter((entry) => entry.version !== version)],
    });
  }
  await putJson(desktopLatestKey(channel), {
    ...signed,
    highestVersion: compareDesktopVersions(version, highest) > 0 ? version : highest,
  });
  return true;
};
