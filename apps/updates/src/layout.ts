/**
 * What the publish script writes to R2 and the service reads back:
 *
 *   assets/<sha256 hex>                         a bundle or asset, by its content
 *   updates/<channel>/<runtime>/<id>.json       a published update (StoredUpdate)
 *   updates/<channel>/<runtime>/latest.json     { updateId }: what that channel's phones get
 *   updates/<channel>/history.json              HistoryEntry[], newest first: what R2 still keeps
 *
 * Moving `latest.json` is the only step that changes what phones receive, so a publish writes it
 * after everything that update needs (release.ts).
 */

export const CHANNELS = ["ti", "main"] as const;
export type Channel = (typeof CHANNELS)[number];

export const isChannel = (value: string): value is Channel =>
  (CHANNELS as readonly string[]).includes(value);

export const assetKey = (key: string): string => `assets/${key}`;
export const updateKey = (channel: Channel, runtimeVersion: string, id: string): string =>
  `updates/${channel}/${encodeURIComponent(runtimeVersion)}/${id}.json`;
export const latestKey = (channel: Channel, runtimeVersion: string): string =>
  `updates/${channel}/${encodeURIComponent(runtimeVersion)}/latest.json`;
export const historyKey = (channel: Channel): string => `updates/${channel}/history.json`;

/** How many updates R2 keeps per channel. Older ones can't be promoted any more. */
export const KEPT_UPDATES = 10;

/** One line of a channel's history. wrangler can't list a bucket, so this is the listing. */
export interface HistoryEntry {
  readonly id: string;
  /** The release's version, which is how the owner names an update to promote. */
  readonly version: string;
  readonly runtimeVersion: string;
  readonly createdAt: string;
  /** The files it needs, by their name in R2. */
  readonly assetKeys: readonly string[];
}

export interface StoredAsset {
  /** Base64url of the file's SHA-256, which expo-updates checks after downloading it. */
  readonly hash: string;
  /** Hex of the same SHA-256: its name in R2 and in the asset's URL. */
  readonly key: string;
  readonly contentType: string;
  readonly fileExtension: string;
}

/** An update as R2 holds it: its manifest, less the asset URLs, which depend on the Worker's. */
export interface StoredUpdate {
  readonly id: string;
  readonly createdAt: string;
  readonly runtimeVersion: string;
  readonly launchAsset: StoredAsset;
  readonly assets: readonly StoredAsset[];
  readonly metadata: Record<string, string>;
  readonly extra: { readonly expoClient: Record<string, unknown> };
}

export interface LatestUpdate {
  readonly updateId: string;
}
