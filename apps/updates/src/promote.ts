/**
 * Rolls a channel back: republishes a version R2 still holds as the channel's newest update.
 * expo-updates only moves to a newer `createdAt`, so pointing `latest.json` at the old update
 * wouldn't move a phone; the promoted update has the old one's files under a new id and time,
 * and so a new signature (release.ts).
 *
 * The update is signed again, so it first has to be the one its release published: R2's copy is
 * checked against the release's sealed provenance record (docs/release-provenance.md) before
 * anything is signed. A rollback needs no new build or source revision, only that record.
 */

import { createHash, createPrivateKey } from "node:crypto";
import {
  type Channel,
  type LatestUpdate,
  type StoredUpdate,
  latestKey,
  updateKey,
} from "./layout.ts";
import { type UpdateBucket, readHistory, releaseUpdate } from "./release.ts";

export interface PromoteOptions extends UpdateBucket {
  readonly channel: Channel;
  /** The release's version, as in `apps/mobile/package.json`. */
  readonly version: string;
  /**
   * The release's sealed provenance record, from its GitHub Release, once the workflow checked
   * it against the tag (release-gate.ts verify-release). Undefined when the release has none.
   */
  readonly provenance?: unknown;
  /**
   * The owner's transition for releases published before records: an update with no record and
   * no list of its files may go back, on its runtime version alone. Anything recorded is still
   * checked in full.
   */
  readonly allowUnrecorded?: boolean;
  /** The private key's PEM. An invalid one throws before anything changes. */
  readonly signingKey: string;
  /** Where phones reach the Worker. */
  readonly origin?: string;
  readonly now?: () => number;
  readonly newId?: () => string;
}

const SHA256 = /^[0-9a-f]{64}$/;

const sha256 = (data: string) => createHash("sha256").update(data).digest("hex");

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** The release gate's digest of a folder from its files' digests (release-gate.ts digestOf). */
const folderDigest = (files: Readonly<Record<string, string>>) =>
  sha256(
    Object.keys(files)
      .sort()
      .map((path) => `${path}\0${files[path]}\n`)
      .join(""),
  );

const sameJson = (a: unknown, b: unknown): boolean => {
  if (Array.isArray(a) || Array.isArray(b))
    return (
      Array.isArray(a) &&
      Array.isArray(b) &&
      a.length === b.length &&
      a.every((item, index) => sameJson(item, b[index]))
    );
  if (isRecord(a) && isRecord(b)) {
    const keys = Object.keys(a);
    return (
      keys.length === Object.keys(b).length &&
      keys.every((key) => Object.hasOwn(b, key) && sameJson(a[key], b[key]))
    );
  }
  return a === b;
};

/**
 * Throws, saying why, unless `update` is what the release's record admitted for this channel:
 * the export the gate digested, every file phones download among it under its own hash, and the
 * app config from it.
 */
const checkProvenance = (
  update: StoredUpdate,
  { channel, version, provenance, allowUnrecorded }: PromoteOptions,
): void => {
  const refuse = (why: string): never => {
    throw new Error(`${version} can't go back on ${channel}: ${why}`);
  };
  if (provenance === undefined) {
    if (update.exported !== undefined)
      refuse("its update was published with a record, and the workflow found none to check.");
    if (!allowUnrecorded)
      refuse(
        "its release has no provenance record. It was published before records; roll back to " +
          "it only through the owner's transition (allow_unrecorded).",
      );
    return;
  }
  if (!isRecord(provenance) || provenance.schema !== "wave-release-provenance/1")
    return refuse("what was given as its record isn't one.");
  const artifact = isRecord(provenance.artifact) ? provenance.artifact : {};
  if (provenance.releaseTag !== `v${version}`)
    refuse(`the record is ${String(provenance.releaseTag)}'s.`);
  if (artifact.updateChannel !== channel)
    refuse(`its record is for the ${String(artifact.updateChannel)} channel.`);
  if (artifact.runtimeVersion !== update.runtimeVersion)
    refuse(`its record is for runtime version ${String(artifact.runtimeVersion)}.`);
  if (typeof artifact.signedSha256 !== "string" || !SHA256.test(artifact.signedSha256))
    refuse("its record isn't sealed, so its release never published it.");
  const exported = update.exported;
  if (!exported) return refuse("its update in R2 has no list of its files to check.");
  if (folderDigest(exported.files) !== artifact.updateSha256)
    refuse("its update in R2 isn't the export its record admitted.");
  const exportedFiles = new Set(Object.values(exported.files));
  for (const asset of [update.launchAsset, ...update.assets]) {
    if (!exportedFiles.has(asset.key)) refuse(`${asset.key} isn't a file of its export.`);
    if (asset.hash !== Buffer.from(asset.key, "hex").toString("base64url"))
      refuse(`${asset.key} is listed under another hash.`);
  }
  const config = exported.config;
  if (config === null || exported.files["expo-config.json"] !== sha256(config))
    return refuse("its app config isn't the one exported.");
  const expected = { ...(JSON.parse(config) as object), runtimeVersion: update.runtimeVersion };
  if (!sameJson(update.extra.expoClient, expected) || !sameJson(update.metadata, {}))
    refuse("its app config isn't the one exported.");
};

/** Promotes the version and answers the new update's id. Throws, saying why, if it can't. */
export const promoteUpdate = async (options: PromoteOptions): Promise<string> => {
  const {
    channel,
    version,
    signingKey,
    origin,
    now = Date.now,
    newId = () => crypto.randomUUID(),
    provenance: _provenance,
    allowUnrecorded: _allowUnrecorded,
    ...bucket
  } = options;
  const privateKey = createPrivateKey(signingKey);
  const history = await readHistory(bucket, channel);
  const current = history[0];
  const target = history.find((entry) => entry.version === version);
  if (!current || !target) {
    const kept = [...new Set(history.map((entry) => entry.version))].join(", ") || "none";
    throw new Error(`${channel} doesn't keep version ${version}. It keeps: ${kept}.`);
  }
  if (target.runtimeVersion !== current.runtimeVersion) {
    throw new Error(
      `${version} can't go back on ${channel}: it was built for runtime version ` +
        `${target.runtimeVersion}, and ${channel}'s phones run ${current.runtimeVersion}. ` +
        `A bundle only runs on an APK with the same native side, so undo this one with a new ` +
        `release instead.`,
    );
  }

  const latest = await bucket.read(latestKey(channel, target.runtimeVersion));
  if (latest !== null && (JSON.parse(latest) as LatestUpdate).updateId === target.id) {
    throw new Error(`${channel}'s phones are already on ${version}.`);
  }

  const stored = await bucket.read(updateKey(channel, target.runtimeVersion, target.id));
  if (stored === null) throw new Error(`R2 has lost update ${target.id} of version ${version}.`);
  const original = JSON.parse(stored) as StoredUpdate;
  checkProvenance(original, options);

  const id = newId();
  const update: StoredUpdate = {
    ...original,
    id,
    createdAt: new Date(now()).toISOString(),
  };
  await releaseUpdate(bucket, channel, update, { signingKey: privateKey, origin });
  return id;
};
