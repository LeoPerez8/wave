/**
 * Turns `expo export`'s output into a published update: its files, then the update, then the
 * channel's `latest.json`, so a failure part way leaves phones on the previous update.
 * `put` is the storage: wrangler in CI (scripts/publish.ts), memory in the tests.
 */

import { type KeyObject, createHash, createPrivateKey, createSign } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  type Channel,
  type StoredAsset,
  type StoredUpdate,
  UPDATES_ORIGIN,
  assetKey,
  latestKey,
  updateKey,
} from "./layout.ts";

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

// What the certificate's metadata says in the APK (apps/mobile/plugins/updateSigning.ts).
const SIGNATURE_PARAMETERS = 'keyid="main", alg="rsa-v1_5-sha256"';

/**
 * An update with its manifest rendered for `origin` and signed. A change to any field, as when
 * promoting an update under a new id, takes signing it again.
 */
export const signUpdate = (
  update: Omit<StoredUpdate, "signed">,
  signingKey: KeyObject | string,
  origin: string = UPDATES_ORIGIN,
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

export interface PublishOptions {
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
  readonly put: (key: string, data: Uint8Array, contentType: string) => Promise<void>;
  readonly now?: () => number;
  readonly newId?: () => string;
}

/** Publishes the update and answers its id. */
export const publishUpdate = async ({
  dir,
  channel,
  runtimeVersion,
  appConfig,
  signingKey,
  origin,
  put,
  now = Date.now,
  newId = () => crypto.randomUUID(),
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
    await put(assetKey(key), data, contentType);
    return { hash: sha256.digest("base64url"), key, contentType, fileExtension };
  };

  const launchAsset = await upload(android.bundle, "application/javascript", ".bundle");
  const assets: StoredAsset[] = [];
  for (const { path, ext } of android.assets) {
    assets.push(await upload(path, CONTENT_TYPES[ext] ?? "application/octet-stream", `.${ext}`));
  }

  const id = newId();
  const update = signUpdate(
    {
      id,
      createdAt: new Date(now()).toISOString(),
      runtimeVersion,
      launchAsset,
      assets,
      metadata: {},
      extra: { expoClient: { ...appConfig, runtimeVersion } },
    },
    privateKey,
    origin,
  );
  const json = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));
  await put(updateKey(channel, runtimeVersion, id), json(update), "application/json");
  await put(latestKey(channel, runtimeVersion), json({ updateId: id }), "application/json");
  return id;
};
