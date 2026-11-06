/**
 * The update policy (docs/spec.md, Build and CI): given where Wave stands, the one thing to do
 * next about an update, or nothing. The app carries the step out and asks again.
 */
import { resolveSkipSwipe } from "./swipe.ts";

/** Checks are at least this far apart. */
export const UPDATE_CHECK_INTERVAL_MS = 15 * 60_000;

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

/**
 * Where a tap on "Update the app" has got to; nothing installs without one. `tapped` hasn't reached
 * Android yet. `atPermissionScreen` has asked Android for its screen, and `awayAtPermissionScreen`
 * has seen Wave leave for it. `handedOver` gave Android the APK, which ends this process or asks for
 * a confirmation.
 */
export type InstallTap =
  "none" | "tapped" | "atPermissionScreen" | "awayAtPermissionScreen" | "handedOver";

/**
 * What a tap on the update button in Settings still wants done: `check` now, whatever the wait,
 * `askMobileData` before a download on a metered network, `download` the version found, or
 * `installBundle`, Install Now's reload on the downloaded bundle. An APK these lead to installs as a
 * tap on the pill does.
 */
export type UpdateRequest = "none" | "check" | "askMobileData" | "download" | "installBundle";

/** What a toast tells the person. Only what they asked for, or an install, gets one. */
export type UpdateNotice =
  "upToDate" | "bundleOnItsWay" | "checkFailed" | "downloadFailed" | "installFailed";

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
  readonly installTap: InstallTap;
  /** This launch has asked the service for the channel's APK. */
  readonly apkChecked: boolean;
  /** The version the last check found on the channel; null when it found none. */
  readonly offeredApkVersion: string | null;
  /**
   * The last install begun, or download rejected, kept across launches. A version that installed
   * is no longer offered, so one still offered with its file gone came to nothing.
   */
  readonly lastApkAttempt: { readonly version: string; readonly at: number } | null;
  readonly updateRequest: UpdateRequest;
}

export type UpdateStep =
  | "check"
  | "checkApk"
  | "askMobileData"
  | "downloadBundle"
  | "applyBundle"
  | "downloadApk"
  | "openInstallPermission"
  | "installApk"
  | "wait";

/**
 * The update an "Install Now" tap takes, or null: a downloaded APK, verified as `offeredApk` says,
 * even one swiped off the pill, once this launch's check has offered its version (a tap installs
 * nothing before); else a downloaded bundle, whether a tap's check or Wave's own fetched it. A
 * pending APK holds bundles back, so it never offers one then.
 */
export type ReadyUpdate = "apk" | "bundle" | null;

const readyUpdate = ({
  nativeUpdate,
  bundleDownloaded,
  offeredApkVersion,
}: Pick<UpdateState, "nativeUpdate" | "bundleDownloaded" | "offeredApkVersion">): ReadyUpdate => {
  if (nativeUpdate === "downloaded") return offeredApkVersion === null ? null : "apk";
  return nativeUpdate === "none" && bundleDownloaded ? "bundle" : null;
};

const isDue = (now: number, last: number | null, interval: number): boolean =>
  last === null ||
  // A clock set back would otherwise hold it off until it caught up.
  now < last ||
  now - last >= interval;

/**
 * Installing ends the process, so it only ever follows a tap, and then at once, music or not. Only
 * with Wave in front: it would close Wave under another app, and Android's permission screen and
 * confirmation can't open from the background.
 */
const apkStep = ({ installTap, installAccess, visible }: UpdateState): UpdateStep | null => {
  if (installTap !== "tapped" || !visible) return null;
  return installAccess === "needsPermission" ? "openInstallPermission" : "installApk";
};

/**
 * A tap, given what's become of Wave since. Leaving ends a tap that hasn't reached Android, so it
 * can't act long after the fact. The exception is leaving for the permission screen: coming back
 * continues the install if it was granted and ends the tap if not, so the screen never reopens by
 * itself. Leaving for Android's confirmation ends it too, so a decline brings the offer back.
 */
export const installTapAfter = (
  tap: InstallTap,
  { visible, installAccess }: Pick<UpdateState, "visible" | "installAccess">,
): InstallTap => {
  switch (tap) {
    case "atPermissionScreen":
      return visible ? tap : "awayAtPermissionScreen";
    case "awayAtPermissionScreen":
      if (!visible) return tap;
      return installAccess === "needsPermission" ? "none" : "tapped";
    case "tapped":
    case "handedOver":
      return visible ? tap : "none";
    case "none":
      return tap;
  }
};

/**
 * A tap once Android's installer has let go of the APK with no install to show for it, or Wave has
 * come back to the front: nothing more will come of the handover, so the offer returns. A newer tap
 * isn't this handover's to end.
 */
export const installTapWhenHandoverEnds = (tap: InstallTap): InstallTap =>
  tap === "handedOver" ? "none" : tap;

/**
 * A request from the update button, given what's become of Wave since. Like a tap, it ends when Wave
 * leaves. A download already running keeps going, and what it brings waits to be offered. Install
 * Now's ends too once its bundle isn't offered any more (an APK turned up).
 */
export const updateRequestAfter = (
  request: UpdateRequest,
  {
    visible,
    ...ready
  }: Pick<UpdateState, "visible" | "nativeUpdate" | "bundleDownloaded" | "offeredApkVersion">,
): UpdateRequest => {
  if (!visible) return "none";
  return request === "installBundle" && readyUpdate(ready) !== "bundle" ? "none" : request;
};

/**
 * The version a tap would install: the file exists under its final name only once its SHA-256
 * matched, so "downloaded" means verified. Null while nothing's ready or a tap is under way.
 */
export const offeredApk = ({
  nativeUpdate,
  offeredApkVersion,
  installTap,
}: Pick<UpdateState, "nativeUpdate" | "offeredApkVersion" | "installTap">): string | null =>
  nativeUpdate === "downloaded" && installTap === "none" ? offeredApkVersion : null;

/** Whether the "Update the app" pill is up. A version swiped away stays away; a newer one doesn't. */
export const updatePillShown = ({
  offered,
  ignored,
  nowPlayingShown,
  cardOpen,
  otherPillShown,
}: {
  readonly offered: string | null;
  /** The version last swiped away, kept across launches. */
  readonly ignored: string | null;
  readonly nowPlayingShown: boolean;
  readonly cardOpen: boolean;
  /** Another floating pill (Go to Suggestions, Current Song) is on screen. */
  readonly otherPillShown: boolean;
}): boolean =>
  offered !== null && offered !== ignored && !nowPlayingShown && !cardOpen && !otherPillShown;

/** Either way sideways, with the mini player's thresholds (a third of the way, or a flick). */
export const updatePillSwipeDismisses = (swipe: {
  readonly translationX: number;
  readonly velocityX: number;
  readonly width: number;
}): boolean => resolveSkipSwipe(swipe) !== null;

/** A whole APK is a lot to fetch again for a failure that may well repeat. */
const apkDownloadIsDue = ({ now, offeredApkVersion, lastApkAttempt }: UpdateState): boolean =>
  lastApkAttempt === null ||
  lastApkAttempt.version !== offeredApkVersion ||
  isDue(now, lastApkAttempt.at, UPDATE_APK_RETRY_INTERVAL_MS);

/** What to do now. Nothing here ticks: the app asks when something it follows changes. */
export const nextUpdateStep = (state: UpdateState): UpdateStep => {
  if (state.working) return "wait";
  // Install Now: the tap is the request, so it reloads at once, music or not, with nothing to fetch.
  if (state.updateRequest === "installBundle" && readyUpdate(state) === "bundle") {
    return "applyBundle";
  }
  const online = state.network !== "none";
  if (state.updateRequest === "check" && online) return "check";
  if (state.nativeUpdate === "available") {
    if (state.updateRequest === "askMobileData" && state.visible) return "askMobileData";
    if (state.updateRequest === "download" && online) return "downloadApk";
  }
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
  // What the last check found isn't kept, so a downloaded APK's offer returns after a restart.
  if (state.visible && online && !state.apkChecked) return "checkApk";
  return "wait";
};

/**
 * What a tap on the update button does, given what's already under way. Install Now takes the ready
 * update at once, music or not: an APK as a tap on the pill does (`install`), a bundle by asking
 * for its reload (`installBundle`).
 */
export const updateButtonAction = ({
  installTap,
  updateRequest,
  downloadingApk,
  ...state
}: Pick<
  UpdateState,
  "nativeUpdate" | "bundleDownloaded" | "offeredApkVersion" | "installTap" | "updateRequest"
> & {
  /** The automatic path is fetching the APK right now. */
  readonly downloadingApk: boolean;
}): "install" | "installBundle" | "check" | "followDownload" | "none" => {
  if (updateRequest !== "none" || installTap !== "none") return "none";
  const ready = readyUpdate(state);
  if (ready === "apk") return "install";
  if (ready === "bundle") return "installBundle";
  return downloadingApk ? "followDownload" : "check";
};

/**
 * Where a tap's check leads. An APK comes first, as a pending one holds bundles back. A bundle only
 * gets a toast: it downloads on its silent path, and the button offers Install Now once it's down.
 * A check that failed and found nothing can't say Wave is up to date. With Wave behind it leads
 * nowhere: the tap is over.
 */
export const afterRequestedCheck = ({
  visible,
  nativeUpdate,
  network,
  bundleAvailable,
  bundleDownloaded,
  checkFailed,
}: Pick<
  UpdateState,
  "visible" | "nativeUpdate" | "network" | "bundleAvailable" | "bundleDownloaded"
> & {
  /** The service failed either question, the bundle's or the APK's. */
  readonly checkFailed: boolean;
}): {
  readonly next: "none" | "install" | "askMobileData" | "download";
  readonly outcome: UpdateNotice | null;
} => {
  if (!visible) return { next: "none", outcome: null };
  if (nativeUpdate === "downloaded") return { next: "install", outcome: null };
  if (nativeUpdate === "available") {
    return { next: network === "metered" ? "askMobileData" : "download", outcome: null };
  }
  if (bundleAvailable || bundleDownloaded) return { next: "none", outcome: "bundleOnItsWay" };
  return { next: "none", outcome: checkFailed ? "checkFailed" : "upToDate" };
};

/**
 * What an APK download ends in. A signed one that a live request asked for becomes a tap, as
 * installing it is what the request meant. With Wave behind no request is live, whatever's been
 * noticed of that yet, so the APK only waits to be offered.
 */
export const afterApkDownload = ({
  download,
  updateRequest,
  visible,
}: Pick<UpdateState, "updateRequest" | "visible"> & {
  /** `signed` is the file CI signed; `failed` is anything else. */
  readonly download: "signed" | "failed";
}): { readonly tapped: boolean; readonly outcome: UpdateNotice | null } => {
  const asked = updateRequest !== "none" && visible;
  return {
    tapped: asked && download === "signed",
    outcome: asked && download === "failed" ? "downloadFailed" : null,
  };
};

/**
 * What to tell the person of a step that failed or stopped on a throw; null when nobody asked for
 * it. Install Now's reload is an install: when it fails, the bundle running now goes on.
 */
export const stoppedStepNotice = ({
  step,
  updateRequest,
}: Pick<UpdateState, "updateRequest"> & {
  readonly step: UpdateStep;
}): UpdateNotice | null => {
  if (step === "installApk" || step === "openInstallPermission") return "installFailed";
  if (updateRequest === "none") return null;
  if (step === "applyBundle") return "installFailed";
  return step === "check" ? "checkFailed" : "downloadFailed";
};

/** What to say when a request can't go on with no network; null when it can. */
export const strandedUpdateRequest = (
  request: UpdateRequest,
  network: UpdateNetwork,
): UpdateNotice | null => {
  if (request === "none" || request === "installBundle" || network !== "none") return null;
  return request === "check" ? "checkFailed" : "downloadFailed";
};

/**
 * The button's face: the refresh glyph at rest, spinning, a download's percentage, whoever started
 * it, or "Install Now" while an update is ready, a bundle or an APK (`readyUpdate`). While a tap's
 * install is under way (handed to Android, or at the permission screen) it's "installing": Install
 * Now held disabled, as a tap couldn't add to it, rather than falling back to the refresh glyph.
 */
export type UpdateButtonLook =
  "idle" | "checking" | "installNow" | "installing" | { readonly downloading: number };

export const updateButtonLook = ({
  updateRequest,
  downloadPercent,
  installTap,
  ...ready
}: Pick<
  UpdateState,
  "updateRequest" | "nativeUpdate" | "bundleDownloaded" | "offeredApkVersion" | "installTap"
> & {
  /** How far the APK download is, while one runs. */
  readonly downloadPercent: number | null;
}): UpdateButtonLook => {
  if (downloadPercent !== null) return { downloading: downloadPercent };
  if (updateRequest === "check") return "checking";
  const update = readyUpdate(ready);
  if (update === null) return "idle";
  return update === "apk" && installTap !== "none" ? "installing" : "installNow";
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

/**
 * [route] for the channel on the service the manifest comes from, its query started with the
 * channel. Null with no channel the service knows or no manifest address to go by.
 */
export const channelServiceUrl = (
  {
    manifestUrl,
    channel,
  }: { readonly manifestUrl: string | undefined; readonly channel: string | null },
  route: string,
): string | null => {
  const manifestPath = "/v1/manifest";
  if (channel !== "ti" && channel !== "main") return null;
  if (!manifestUrl?.endsWith(manifestPath)) return null;
  // not UI text: an address
  return `${manifestUrl.slice(0, -manifestPath.length)}${route}?channel=${channel}`;
};

/** Where the channel's APK is told: on the service the manifest comes from. */
export const latestApkUrl = (where: {
  readonly manifestUrl: string | undefined;
  readonly channel: string | null;
}): string | null => channelServiceUrl(where, "/v1/apk");

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

/**
 * How long after Install Now's reload began its launch still counts as that reload's. A reload
 * that failed or never came leaves its mark behind, and a later launch mustn't start music for it.
 */
export const RELOAD_RESUME_WINDOW_MS = 60_000;

/**
 * Whether Wave starts the queue once Install Now's reload is over. Playback lives in the native
 * service, so the player may well have played through the reload; if it stopped, the queue the
 * restore brought back (same song, same place) plays again, but only if music was playing before.
 */
export const resumesAfterReload = ({
  playingAtReload,
  now,
  playing,
  queueLoaded,
}: {
  /** When a reload began with music playing, or about to (`playerKeepsPlaying`); null if none. */
  readonly playingAtReload: number | null;
  readonly now: number;
  /** It is playing now. */
  readonly playing: boolean;
  /** The queue is back, from the player or the saved one. */
  readonly queueLoaded: boolean;
}): boolean =>
  playingAtReload !== null &&
  now >= playingAtReload &&
  now - playingAtReload <= RELOAD_RESUME_WINDOW_MS &&
  !playing &&
  queueLoaded;

/** Whether the player is playing, or means to as soon as it has buffered. */
export const playerKeepsPlaying = (player: {
  readonly status: "idle" | "buffering" | "ready" | "ended";
  readonly isPlaying: boolean;
  readonly playWhenReady: boolean;
}): boolean =>
  player.isPlaying ||
  (player.playWhenReady && (player.status === "buffering" || player.status === "ready"));
