/**
 * Over-the-air updates arriving unnoticed (docs/spec.md, Build and CI): connects the update runner
 * to `expo-updates`, the phone's state and the app log. Wave asks when it comes to the front or
 * leaves it, and in the background when the player changes; it holds no timer.
 */
import {
  latestApkUrl,
  nativeUpdateIsNew,
  playerKeepsPlaying,
  readLatestApk,
  readSignedApk,
  type InstallAccess,
  type LatestApk,
  type NativeUpdate,
  type UpdateNetwork,
  type UpdateState,
} from "@wave/core";
import * as Effect from "effect/Effect";
import Constants from "expo-constants";
import * as Updates from "expo-updates";
import { useSyncExternalStore } from "react";
import { AppState } from "react-native";

import { persistedSetting } from "@/lib/persistedSetting";
import { appLog, flushAppLogNow } from "@/log/appLog";
import { connectivityNow } from "@/native/waveNative";
import { WaveSelfInstall } from "@/native/waveSelfInstall";
import { playbackState } from "@/playback/Player";

import { createUpdateRunner } from "./updateRunner";

/** How long the service gets to say which APK is the newest. */
const APK_CHECK_TIMEOUT = "15 seconds";

const keptTime = (key: string) =>
  persistedSetting<number | null>({
    key,
    read: (stored) => {
      const at = stored === null ? NaN : Number(stored);
      return Number.isFinite(at) ? at : null;
    },
    write: (at) => (at === null ? null : String(at)),
  });

const lastCheckAt = keptTime("updates.lastCheckAt");
const lastApkAttempt = persistedSetting<UpdateState["lastApkAttempt"]>({
  key: "updates.lastApkAttempt",
  read: (stored) => {
    const separator = stored?.lastIndexOf(" ") ?? -1;
    if (stored == null || separator < 0) return null;
    const at = Number(stored.slice(separator + 1));
    return Number.isFinite(at) ? { version: stored.slice(0, separator), at } : null;
  },
  write: (attempt) => (attempt === null ? null : `${attempt.version} ${attempt.at}`),
});

/** The version last swiped off the update pill. A newer one has another name, so it shows. */
const ignoredApkVersion = persistedSetting<string | null>({
  key: "updates.ignoredApkVersion",
  read: (stored) => stored,
  write: (version) => version,
});

const network = (): UpdateNetwork => {
  const { online, onMobileData } = connectivityNow();
  if (!online) return "none";
  return onMobileData ? "metered" : "unmetered";
};

/** What the last check found, which the download and the install act on. */
let latestApk: LatestApk | null = null;

const needLatestApk = (): LatestApk => {
  if (latestApk === null) throw new Error("No APK found yet");
  return latestApk;
};

/** Why the answer isn't to be trusted, for the log. Phones install only what CI signed. */
const refuseApk = (why: string): null => {
  appLog("warn", "WaveUpdates", `No native update: ${why}`);
  return null;
};

const fetchLatestApk = (
  url: string,
  installer: NonNullable<typeof WaveSelfInstall>,
): Effect.Effect<LatestApk | null, unknown> =>
  Effect.tryPromise(async (signal) => {
    const response = await fetch(url, { signal });
    // The channel hasn't published one yet.
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`The service answered ${response.status}`);
    const signed = readSignedApk((await response.json()) as unknown);
    if (signed === null) return refuseApk("the metadata has no signature");
    const check = await installer.checkApkMetadata(signed.metadata, signed.signature);
    if (check !== "valid") return refuseApk(`the metadata's signature check said ${check}`);
    return (
      readLatestApk(signed.metadata, Updates.channel) ??
      refuseApk("the signed metadata is unusable")
    );
  }).pipe(Effect.timeout(APK_CHECK_TIMEOUT));

const checkNative: Effect.Effect<NativeUpdate, unknown> = Effect.suspend(() => {
  const url = latestApkUrl({
    manifestUrl: Constants.expoConfig?.updates?.url,
    channel: Updates.channel,
  });
  const installedRuntimeVersion = Updates.runtimeVersion;
  if (WaveSelfInstall === null || url === null || !installedRuntimeVersion) {
    return Effect.succeed<NativeUpdate>("none");
  }
  const installer = WaveSelfInstall;
  return fetchLatestApk(url, installer).pipe(
    Effect.andThen((latest) =>
      Effect.tryPromise(async (): Promise<NativeUpdate> => {
        latestApk = latest;
        if (latest === null) return "none";
        const installedVersion = await installer.installedVersion();
        if (!nativeUpdateIsNew({ installedRuntimeVersion, installedVersion, latest })) {
          return "none";
        }
        return (await installer.hasApk(latest.version, latest.size)) ? "downloaded" : "available";
      }),
    ),
  );
});

/** It can only change while Wave is away, so it's read then and not at every player change. */
let installAccess: InstallAccess = "needsPermission";

/** Keeps the last answer when the phone gives none. */
const refreshInstallAccess = async (): Promise<void> => {
  try {
    installAccess = (await WaveSelfInstall?.installAccess()) ?? "needsPermission";
  } catch (error) {
    appLog("warn", "WaveUpdates", `Couldn't read the install access: ${String(error)}`);
  }
};

const runner = createUpdateRunner({
  client: {
    check: Effect.tryPromise(() => Updates.checkForUpdateAsync()).pipe(
      Effect.map((result) => result.isAvailable),
    ),
    download: Effect.tryPromise(() => Updates.fetchUpdateAsync()).pipe(
      Effect.map((result) => result.isNew || result.isRollBackToEmbedded),
    ),
    apply: Effect.tryPromise(() => {
      // The restart takes the waiting lines with it.
      flushAppLogNow();
      return Updates.reloadAsync();
    }),
    checkNative,
    downloadApk: Effect.tryPromise(() => {
      if (WaveSelfInstall === null) throw new Error("No installer in this build");
      const { url, version, size, sha256 } = needLatestApk();
      return WaveSelfInstall.downloadApk(url, version, size, sha256);
    }),
    // Coming back from Android's screen brings Wave to the front, which asks the policy again.
    openInstallPermission: Effect.try(() => {
      if (WaveSelfInstall === null) throw new Error("No installer in this build");
      WaveSelfInstall.openPermissionScreen();
    }),
    installApk: Effect.tryPromise(() => {
      if (WaveSelfInstall === null) throw new Error("No installer in this build");
      // The install takes the waiting lines with it.
      flushAppLogNow();
      const { version, sha256 } = needLatestApk();
      return WaveSelfInstall.install(version, sha256);
    }),
    offeredApkVersion: () => latestApk?.version ?? null,
  },
  surroundings: () => ({
    network: network(),
    playing: playerKeepsPlaying(playbackState.get()),
    visible: AppState.currentState === "active",
    installAccess,
  }),
  now: Date.now,
  lastCheckAt,
  lastApkAttempt,
  log: (level, message) => appLog(level, "WaveUpdates", message),
});

const reconsiderWithFreshAccess = (): void => {
  void refreshInstallAccess().then(runner.reconsider);
};

/**
 * What "Update the app" does, wherever it's offered: installs the downloaded APK now, or opens
 * Android's permission screen first. It's the only thing that installs an APK.
 */
export const installAppUpdate = (): void => {
  runner.requestInstall();
  reconsiderWithFreshAccess();
};

/** Stops the pill offering the version on offer. A newer one offers itself again. */
export const ignoreAppUpdate = (): void => {
  const version = runner.offeredVersion();
  if (version !== null) ignoredApkVersion.set(version);
};

/** The APK version ready to install at a tap, or null. */
export const useOfferedAppUpdate = (): string | null =>
  useSyncExternalStore(runner.subscribe, runner.offeredVersion);

/** The version swiped off the pill, if any. */
export const useIgnoredAppUpdate = (): string | null => ignoredApkVersion.useValue();

let started = false;

/** Starts following the phone, once per JS runtime; a build with updates off does nothing. */
export const startAppUpdates = (): void => {
  if (started || !Updates.isEnabled) return;
  started = true;
  let stopFollowingPlayer: (() => void) | null = null;
  const followPlayerIfHidden = (): void => {
    if (AppState.currentState === "active") {
      stopFollowingPlayer?.();
      stopFollowingPlayer = null;
    } else {
      stopFollowingPlayer ??= playbackState.subscribe(runner.reconsider);
    }
  };
  AppState.addEventListener("change", () => {
    followPlayerIfHidden();
    reconsiderWithFreshAccess();
  });
  followPlayerIfHidden();
  reconsiderWithFreshAccess();
};
