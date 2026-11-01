/**
 * The update policy (docs/spec.md, Build and CI): given where Wave stands, the one thing to do
 * next about an update, or nothing. The app carries the step out and asks again.
 */

/** Checks are at least this far apart. */
export const UPDATE_CHECK_INTERVAL_MS = 15 * 60_000;

/** After a declined question or confirmation, Wave asks again this long after, so it never nags. */
export const UPDATE_INSTALL_ASK_INTERVAL_MS = 24 * 60 * 60_000;

/** After a failed install or a rejected download, that version's APK waits this long to download. */
export const UPDATE_APK_RETRY_INTERVAL_MS = 24 * 60 * 60_000;

/** What the phone is on. A bundle downloads on anything but `none`, an APK only on `unmetered`. */
export type UpdateNetwork = "none" | "metered" | "unmetered";

/** The channel's APK as far as this phone goes: none newer, found, or on the phone ready to install. */
export type NativeUpdate = "none" | "available" | "downloaded";

/**
 * What installing an APK takes on this phone. Android asks for the "install from this source"
 * permission, then for one confirmation until Wave is the installer of record, then nothing.
 */
export type InstallAccess = "needsPermission" | "needsConfirmation" | "silent";

export interface UpdateState {
  readonly now: number;
  /** When a check last started, whatever came of it; null when none has. */
  readonly lastCheckAt: number | null;
  readonly network: UpdateNetwork;
  /** Music is playing or about to (`playerKeepsPlaying`). */
  readonly playing: boolean;
  /** Wave is in the foreground. */
  readonly visible: boolean;
  /** A step is still running. */
  readonly working: boolean;
  /** A check found a bundle that isn't downloaded yet. */
  readonly bundleAvailable: boolean;
  /** A downloaded bundle waits to run. */
  readonly bundleDownloaded: boolean;
  readonly nativeUpdate: NativeUpdate;
  readonly installAccess: InstallAccess;
  /** When Wave last asked for the install permission, kept across launches; null when it hasn't. */
  readonly lastInstallAskAt: number | null;
  /** When an install last started, kept across launches; null when none has. */
  readonly lastInstallAt: number | null;
  /** The version the last check found on the channel; null when it found none. */
  readonly offeredApkVersion: string | null;
  /**
   * The last install begun, or download rejected, kept across launches. A version that installed
   * is no longer offered, so one still offered with its file gone came to nothing.
   */
  readonly lastApkAttempt: { readonly version: string; readonly at: number } | null;
}

export type UpdateStep =
  | "check"
  | "downloadBundle"
  | "applyBundle"
  | "downloadApk"
  | "askInstallPermission"
  | "installApk"
  | "wait";

const isDue = (now: number, last: number | null, interval: number): boolean =>
  last === null ||
  // A clock set back would otherwise hold it off until it caught up.
  now < last ||
  now - last >= interval;

/** Installing ends the process, so a silent install needs Wave out of use and nothing playing. */
const apkStep = (state: UpdateState): UpdateStep | null => {
  const { now, visible, playing, installAccess, lastInstallAt, lastInstallAskAt } = state;
  switch (installAccess) {
    case "needsPermission":
      return visible && isDue(now, lastInstallAskAt, UPDATE_INSTALL_ASK_INTERVAL_MS)
        ? "askInstallPermission"
        : null;
    case "needsConfirmation":
      // Android's confirmation can't open from the background (docs/spec.md, Native updates).
      return visible && !playing && isDue(now, lastInstallAt, UPDATE_INSTALL_ASK_INTERVAL_MS)
        ? "installApk"
        : null;
    case "silent":
      return !visible && !playing && isDue(now, lastInstallAt, UPDATE_CHECK_INTERVAL_MS)
        ? "installApk"
        : null;
  }
};

/** A whole APK is a lot to fetch again for a failure that may well repeat. */
const apkDownloadIsDue = ({ now, offeredApkVersion, lastApkAttempt }: UpdateState): boolean =>
  lastApkAttempt === null ||
  lastApkAttempt.version !== offeredApkVersion ||
  isDue(now, lastApkAttempt.at, UPDATE_APK_RETRY_INTERVAL_MS);

/** What to do now. Nothing here ticks: the app asks when something it follows changes. */
export const nextUpdateStep = (state: UpdateState): UpdateStep => {
  if (state.working) return "wait";
  const online = state.network !== "none";
  if (
    state.nativeUpdate === "available" &&
    state.network === "unmetered" &&
    apkDownloadIsDue(state)
  ) {
    return "downloadApk";
  }
  if (state.nativeUpdate === "downloaded") {
    const step = apkStep(state);
    if (step !== null) return step;
  }
  // An APK holds the matching JS, so a bundle is dropped while one is pending.
  if (state.nativeUpdate === "none") {
    if (state.bundleAvailable && online) return "downloadBundle";
    if (state.bundleDownloaded && !state.visible && !state.playing) return "applyBundle";
  }
  // A failed check or download retries here, once the 15 minutes are up and Wave is back in front.
  if (state.visible && online && isDue(state.now, state.lastCheckAt, UPDATE_CHECK_INTERVAL_MS)) {
    return "check";
  }
  return "wait";
};

/** The channel's newest APK, as CI signed it. The channel stops one reaching the other's phones. */
export interface LatestApk {
  readonly version: string;
  readonly runtimeVersion: string;
  readonly url: string;
  readonly size: number;
  readonly channel: string;
  /** Hex of the file's SHA-256, which the phone checks before it installs. */
  readonly sha256: string;
}

/** What the update service answers (`GET /v1/apk`): the exact bytes CI signed, and the signature. */
export interface SignedApk {
  readonly metadata: string;
  /** Base64 of the RSA-SHA256 signature over `metadata`'s UTF-8 bytes. */
  readonly signature: string;
}

/** The answer's two parts, or null when either is missing. Says nothing of the signature's worth. */
export const readSignedApk = (answer: unknown): SignedApk | null => {
  if (typeof answer !== "object" || answer === null) return null;
  const { metadata, signature } = answer as Record<string, unknown>;
  if (typeof metadata !== "string" || typeof signature !== "string" || signature === "") {
    return null;
  }
  return { metadata, signature };
};

const parsedJson = (text: string): unknown => {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
};

/**
 * The metadata a verified signature covers, or null when it's malformed, belongs to another channel
 * or names an address Wave won't download from.
 */
export const readLatestApk = (metadata: string, channel: string | null): LatestApk | null => {
  const read = parsedJson(metadata);
  if (typeof read !== "object" || read === null) return null;
  const { version, runtimeVersion, url, size, sha256 } = read as Record<string, unknown>;
  const { channel: signedFor } = read as Record<string, unknown>;
  if (typeof version !== "string" || typeof runtimeVersion !== "string") return null;
  if (typeof url !== "string" || !url.startsWith("https://")) return null;
  if (typeof size !== "number" || !(size > 0)) return null;
  if (typeof signedFor !== "string" || signedFor !== channel) return null;
  if (typeof sha256 !== "string" || !/^[0-9a-f]{64}$/.test(sha256)) return null;
  return { version, runtimeVersion, url, size, channel: signedFor, sha256 };
};

/** Where the channel's APK is told: on the service the manifest comes from. */
export const latestApkUrl = ({
  manifestUrl,
  channel,
}: {
  readonly manifestUrl: string | undefined;
  readonly channel: string | null;
}): string | null => {
  const manifestPath = "/v1/manifest";
  if (channel !== "ti" && channel !== "main") return null;
  if (!manifestUrl?.endsWith(manifestPath)) return null;
  // not UI text: an address
  return `${manifestUrl.slice(0, -manifestPath.length)}/v1/apk?channel=${channel}`;
};

/**
 * A version's place in the sequence both channels share, or null if it isn't a version. Android's
 * versionCode is the same number, and minor and patch stay under 100 (docs/spec.md, Releases).
 */
export const versionOrder = (version: string): number | null => {
  const match = /^(\d+)\.(\d{1,2})\.(\d{1,2})(?:-ti)?$/.exec(version);
  return match ? Number(match[1]) * 10000 + Number(match[2]) * 100 + Number(match[3]) : null;
};

/**
 * Whether the channel's APK is one to install: another native side (the runtime version, so a
 * repacked APK, which keeps its key, never counts), and newer, as Android refuses a downgrade.
 */
export const nativeUpdateIsNew = ({
  installedRuntimeVersion,
  installedVersion,
  latest,
}: {
  readonly installedRuntimeVersion: string;
  readonly installedVersion: string;
  readonly latest: LatestApk;
}): boolean => {
  if (latest.runtimeVersion === installedRuntimeVersion) return false;
  const installed = versionOrder(installedVersion);
  const offered = versionOrder(latest.version);
  return installed !== null && offered !== null && offered > installed;
};

/** Whether the player is playing, or means to as soon as it has buffered. */
export const playerKeepsPlaying = (player: {
  readonly status: "idle" | "buffering" | "ready" | "ended";
  readonly isPlaying: boolean;
  readonly playWhenReady: boolean;
}): boolean =>
  player.isPlaying ||
  (player.playWhenReady && (player.status === "buffering" || player.status === "ready"));
