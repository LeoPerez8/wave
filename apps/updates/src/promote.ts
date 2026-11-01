/**
 * Rolls a channel back: republishes a version R2 still holds as the channel's newest update.
 * expo-updates only moves to a newer `createdAt`, so pointing `latest.json` at the old update
 * wouldn't move a phone; the promoted update has the old one's files under a new id and time.
 */

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
  readonly now?: () => number;
  readonly newId?: () => string;
}

/** Promotes the version and answers the new update's id. Throws, saying why, if it can't. */
export const promoteUpdate = async ({
  channel,
  version,
  now = Date.now,
  newId = () => crypto.randomUUID(),
  ...bucket
}: PromoteOptions): Promise<string> => {
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

  const id = newId();
  const update: StoredUpdate = {
    ...(JSON.parse(stored) as StoredUpdate),
    id,
    createdAt: new Date(now()).toISOString(),
  };
  await releaseUpdate(bucket, channel, update);
  return id;
};
