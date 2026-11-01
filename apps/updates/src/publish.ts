/**
 * Turns `expo export`'s output into a published update: its files, then the update itself
 * (release.ts), so a failure part way leaves phones on the previous update.
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { type Channel, type StoredAsset, type StoredUpdate, assetKey } from "./layout.ts";
import { type UpdateBucket, releaseUpdate } from "./release.ts";

const CONTENT_TYPES: Record<string, string> = {
  gif: "image/gif",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  json: "application/json",
  otf: "font/otf",
  png: "image/png",
  svg: "image/svg+xml",
  ttf: "font/ttf",
  webp: "image/webp",
};

interface ExportMetadata {
  readonly fileMetadata: {
    readonly android?: {
      readonly bundle: string;
      readonly assets: readonly { readonly path: string; readonly ext: string }[];
    };
  };
}

export interface PublishOptions extends UpdateBucket {
  /** `expo export --platform android`'s output folder. */
  readonly dir: string;
  readonly channel: Channel;
  readonly runtimeVersion: string;
  /** `expo config --type public`: under an update, Constants.expoConfig is this. */
  readonly appConfig: Record<string, unknown>;
  readonly now?: () => number;
  readonly newId?: () => string;
}

/** Publishes the update and answers its id. */
export const publishUpdate = async ({
  dir,
  channel,
  runtimeVersion,
  appConfig,
  now = Date.now,
  newId = () => crypto.randomUUID(),
  ...bucket
}: PublishOptions): Promise<string> => {
  const metadata = JSON.parse(readFileSync(join(dir, "metadata.json"), "utf8")) as ExportMetadata;
  const android = metadata.fileMetadata.android;
  if (!android) throw new Error("The export has no Android bundle.");

  const upload = async (
    path: string,
    contentType: string,
    fileExtension: string,
  ): Promise<StoredAsset> => {
    const data = readFileSync(join(dir, path));
    const sha256 = createHash("sha256").update(data);
    const key = sha256.copy().digest("hex");
    await bucket.put(assetKey(key), data, contentType);
    return { hash: sha256.digest("base64url"), key, contentType, fileExtension };
  };

  const launchAsset = await upload(android.bundle, "application/javascript", ".bundle");
  const assets: StoredAsset[] = [];
  for (const { path, ext } of android.assets) {
    assets.push(await upload(path, CONTENT_TYPES[ext] ?? "application/octet-stream", `.${ext}`));
  }

  const id = newId();
  const update: StoredUpdate = {
    id,
    createdAt: new Date(now()).toISOString(),
    runtimeVersion,
    launchAsset,
    assets,
    metadata: {},
    extra: { expoClient: { ...appConfig, runtimeVersion } },
  };
  await releaseUpdate(bucket, channel, update);
  return id;
};
