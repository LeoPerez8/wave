/**
 * What the publish script writes to R2 and the service reads back:
 *
 *   assets/<sha256 hex>                         a bundle or asset, by its content
 *   updates/<channel>/<runtime>/<id>.json       a published update (StoredUpdate)
 *   updates/<channel>/<runtime>/latest.json     { updateId }: what that channel's phones get
 *   notes/<channel>/<version>.json              a release's notes (ReleaseNotes)
 *   updates/<channel>/history.json              HistoryEntry[], newest first: what R2 still keeps
 *   apks/<channel>/latest.json                  LatestApk: the channel's newest APK
 *
 * Moving `latest.json` is the only step that changes what phones receive, so a publish writes it
 * after everything that update needs (release.ts).
 */

/** The Worker's address, which a signed manifest's asset URLs name. app.config.ts asks it too. */
export const UPDATES_ORIGIN = "https://wave-updates.leonardolp2424.workers.dev";

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

export const latestApkKey = (channel: Channel): string => `apks/${channel}/latest.json`;

/** A channel's newest APK. R2 holds this much; the APK itself stays on its GitHub Release. */
export interface LatestApk {
  readonly version: string;
  /** Its native side (`scripts/ci/repack.ts`'s key): phones on another one have this to install. */
  readonly runtimeVersion: string;
  readonly url: string;
  readonly size: number;
}

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
  readonly signed: SignedManifest;
}

/**
 * The manifest as phones receive it. The signature covers these exact bytes, asset URLs included,
 * and the Worker has no key, so it serves them as they are.
 */
export interface SignedManifest {
  readonly manifest: string;
  /** The value of the manifest part's `expo-signature` header. */
  readonly signature: string;
}

export interface LatestUpdate {
  readonly updateId: string;
}
