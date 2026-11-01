/**
 * Hands an update to a channel's phones. A publish and a promotion both end here, so this is the
 * one place an update's manifest is written and signed. A signature covers the id and the time,
 * so a promotion is signed again here and never reuses the one it found in R2.
 *
 * It signs first, so a bad key changes nothing, then writes the update, the channel's history and
 * `latest.json`, so a failure part way leaves phones on the previous update.
 */

import { type KeyObject, createSign } from "node:crypto";
import {
  type Channel,
  type HistoryEntry,
  type StoredAsset,
  type StoredUpdate,
  CHANNELS,
  KEPT_UPDATES,
  UPDATES_ORIGIN,
  assetKey,
  historyKey,
  latestKey,
  updateKey,
} from "./layout.ts";

/** R2 as CI reaches it: wrangler in scripts/, memory in the tests. */
export interface UpdateBucket {
  readonly put: (key: string, data: Uint8Array, contentType: string) => Promise<void>;
  /** The object's text, or null when there's none. Throws when it can't tell. */
  readonly read: (key: string) => Promise<string | null>;
  /** Removing what isn't there is fine. */
  readonly remove: (key: string) => Promise<void>;
}

/** What signs a manifest. CI alone holds the key; the Worker serves the bytes as they are. */
export interface UpdateSigning {
  /** The private key, or its PEM. */
  readonly signingKey: KeyObject | string;
  /** Where phones reach the Worker: a signed manifest names its files' URLs. */
  readonly origin?: string | undefined;
}

// What the certificate's metadata says in the APK (apps/mobile/plugins/updateSigning.ts).
const SIGNATURE_PARAMETERS = 'keyid="main", alg="rsa-v1_5-sha256"';

/** The update with a manifest rendered and signed from its fields, whatever it was signed with. */
const signUpdate = (
  update: Omit<StoredUpdate, "signed">,
  { signingKey, origin = UPDATES_ORIGIN }: UpdateSigning,
): StoredUpdate => {
  const { signed: _, ...fields } = update as StoredUpdate;
  const withUrl = (asset: StoredAsset) => ({
    ...asset,
    url: `${origin}/v1/assets/${asset.key}`,
  });
  const manifest = JSON.stringify({
    ...fields,
    launchAsset: withUrl(fields.launchAsset),
    assets: fields.assets.map(withUrl),
  });
  const sig = createSign("RSA-SHA256").update(manifest, "utf8").sign(signingKey, "base64");
  return { ...fields, signed: { manifest, signature: `sig="${sig}", ${SIGNATURE_PARAMETERS}` } };
};

const json = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));

export const readHistory = async (
  bucket: UpdateBucket,
  channel: Channel,
): Promise<readonly HistoryEntry[]> => {
  const history = await bucket.read(historyKey(channel));
  return history === null ? [] : (JSON.parse(history) as HistoryEntry[]);
};

const writeHistory = (bucket: UpdateBucket, channel: Channel, history: readonly HistoryEntry[]) =>
  bucket.put(historyKey(channel), json(history), "application/json");

const assetKeys = (entry: HistoryEntry) => entry.assetKeys;

/**
 * Removes what's past the channel's limit, then drops it from the history, so a removal that
 * fails is tried again by the next release. A file stays while any update of either channel
 * still names it: files are named by content, so the channels share them.
 */
const prune = async (bucket: UpdateBucket, channel: Channel, history: readonly HistoryEntry[]) => {
  const kept = history.slice(0, KEPT_UPDATES);
  const removed = history.slice(KEPT_UPDATES);
  if (removed.length === 0) return;

  const others = await Promise.all(
    CHANNELS.filter((other) => other !== channel).map((other) => readHistory(bucket, other)),
  );
  const named = new Set([...kept, ...others.flat()].flatMap(assetKeys));
  for (const key of new Set(removed.flatMap(assetKeys))) {
    if (!named.has(key)) await bucket.remove(assetKey(key));
  }
  for (const { id, runtimeVersion } of removed) {
    await bucket.remove(updateKey(channel, runtimeVersion, id));
    // An APK of a runtime with nothing left finds no update rather than a broken pointer.
    if (!kept.some((entry) => entry.runtimeVersion === runtimeVersion)) {
      await bucket.remove(latestKey(channel, runtimeVersion));
    }
  }
  await writeHistory(bucket, channel, kept);
};

/** Signs `update`, makes it what the channel's phones get for its runtime version, trims. */
export const releaseUpdate = async (
  bucket: UpdateBucket,
  channel: Channel,
  unsigned: Omit<StoredUpdate, "signed">,
  signing: UpdateSigning,
): Promise<void> => {
  const update = signUpdate(unsigned, signing);
  const { id, createdAt, runtimeVersion } = update;
  const entry: HistoryEntry = {
    id,
    version: String(update.extra.expoClient.version ?? ""),
    runtimeVersion,
    createdAt,
    assetKeys: [update.launchAsset.key, ...update.assets.map(({ key }) => key)],
  };
  const history = [entry, ...(await readHistory(bucket, channel))];

  await bucket.put(updateKey(channel, runtimeVersion, id), json(update), "application/json");
  await writeHistory(bucket, channel, history);
  await bucket.put(latestKey(channel, runtimeVersion), json({ updateId: id }), "application/json");

  // Phones already have the update, so trimming can't fail the release.
  await prune(bucket, channel, history).catch((error: unknown) => {
    console.warn(`Couldn't remove the old updates of ${channel}; the next release retries:`, error);
  });
};
