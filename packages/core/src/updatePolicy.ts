/**
 * The update policy (docs/spec.md, Build and CI): given where Wave stands, the one thing to do
 * next about an update, or nothing. The app carries the step out and asks again.
 */

/** Checks are at least this far apart. */
export const UPDATE_CHECK_INTERVAL_MS = 15 * 60_000;

/** After a declined question or confirmation, Wave asks again this long after, so it never nags. */
export const UPDATE_INSTALL_ASK_INTERVAL_MS = 24 * 60 * 60_000;

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

/** What to do now. Nothing here ticks: the app asks when something it follows changes. */
export const nextUpdateStep = (state: UpdateState): UpdateStep => {
  if (state.working) return "wait";
  const online = state.network !== "none";
  if (state.nativeUpdate === "available" && state.network === "unmetered") return "downloadApk";
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

/** What the update service says of a channel's newest APK (`GET /v1/apk`). */
export interface LatestApk {
  readonly version: string;
  readonly runtimeVersion: string;
  readonly url: string;
  readonly size: number;
}

/** The answer, or null when it's malformed or names an address Wave won't download from. */
export const readLatestApk = (answer: unknown): LatestApk | null => {
  if (typeof answer !== "object" || answer === null) return null;
  const { version, runtimeVersion, url, size } = answer as Record<string, unknown>;
  if (typeof version !== "string" || typeof runtimeVersion !== "string") return null;
  if (typeof url !== "string" || !url.startsWith("https://")) return null;
  if (typeof size !== "number" || !(size > 0)) return null;
  return { version, runtimeVersion, url, size };
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

// The sequence both channels share; the versionCode Android compares comes from the same numbers.
const versionOrder = (version: string): number | null => {
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
