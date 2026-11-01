/**
 * Turns `expo export`'s output into a published update: its files, then the update itself
 * (release.ts), so a failure part way leaves phones on the previous update.
 */

import { createHash, createPrivateKey } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  type Channel,
  type LatestApk,
  type ReleaseNotes,
  type StoredAsset,
  assetKey,
  latestApkKey,
  notesKey,
} from "./layout.ts";
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
  /** The private key's PEM. An invalid one throws before anything is uploaded. */
  readonly signingKey: string;
  /** Where phones reach the Worker. */
  readonly origin?: string;
  readonly now?: () => number;
  readonly newId?: () => string;
}

/** Publishes a release's notes, unless the release lists no PR. Answers whether it did. */
export const publishNotes = async ({
  channel,
  version,
  notes,
  put,
}: {
  readonly channel: Channel;
  readonly version: string;
  readonly notes: ReleaseNotes;
  readonly put: PublishOptions["put"];
}): Promise<boolean> => {
  if (notes.en.new.length === 0 && notes.en.fixes.length === 0) return false;
  const data = new TextEncoder().encode(JSON.stringify(notes));
  await put(notesKey(channel, version), data, "application/json");
  return true;
};

/** Makes `apk` what the channel's phones are told of. Throws on one they wouldn't download. */
export const publishLatestApk = async ({
  channel,
  apk,
  put,
}: {
  readonly channel: Channel;
  readonly apk: LatestApk;
  readonly put: PublishOptions["put"];
}): Promise<void> => {
  if (!apk.url.startsWith("https://")) throw new Error(`Not an https address: ${apk.url}`);
  if (!(apk.size > 0)) throw new Error(`Not an APK's size: ${apk.size}`);
  if (apk.runtimeVersion === "") throw new Error("No runtime version");
  const data = new TextEncoder().encode(JSON.stringify(apk));
  await put(latestApkKey(channel), data, "application/json");
};

/** Publishes the update and answers its id. */
export const publishUpdate = async ({
  dir,
  channel,
  runtimeVersion,
  appConfig,
  signingKey,
  origin,
  now = Date.now,
  newId = () => crypto.randomUUID(),
  ...bucket
}: PublishOptions): Promise<string> => {
  const privateKey = createPrivateKey(signingKey);
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
  const update = {
    id,
    createdAt: new Date(now()).toISOString(),
    runtimeVersion,
    launchAsset,
    assets,
    metadata: {},
    extra: { expoClient: { ...appConfig, runtimeVersion } },
  };
  await releaseUpdate(bucket, channel, update, { signingKey: privateKey, origin });
  return id;
};
