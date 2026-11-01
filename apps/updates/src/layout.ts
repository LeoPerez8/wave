/**
 * What the publish script writes to R2 and the service reads back:
 *
 *   assets/<sha256 hex>                         a bundle or asset, by its content
 *   updates/<channel>/<runtime>/<id>.json       a published update (StoredUpdate)
 *   updates/<channel>/<runtime>/latest.json     { updateId }: what that channel's phones get
 *   notes/<channel>/<version>.json              a release's notes (ReleaseNotes)
 *
 * Moving `latest.json` is the only step that changes what phones receive, so a publish writes it
 * last, and an earlier update stays in R2 for it to point back to.
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

export const notesPrefix = (channel: Channel): string => `notes/${channel}/`;
export const notesKey = (channel: Channel, version: string): string =>
  `${notesPrefix(channel)}${version}.json`;

/** A release's notes in one language, one line per PR. */
export interface NoteSections {
  readonly new: readonly string[];
  readonly fixes: readonly string[];
}

/** A release's notes as R2 holds them (`scripts/ci/localized-notes.ts` builds them). */
export interface ReleaseNotes {
  readonly en: NoteSections;
  readonly "pt-BR": NoteSections;
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
