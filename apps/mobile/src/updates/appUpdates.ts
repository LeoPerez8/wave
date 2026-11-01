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
  type InstallAccess,
  type LatestApk,
  type NativeUpdate,
  type UpdateNetwork,
} from "@wave/core";
import * as Effect from "effect/Effect";
import Constants from "expo-constants";
import * as Updates from "expo-updates";
import { AppState } from "react-native";

import { persistedSetting } from "@/lib/persistedSetting";
import { currentLocalisation } from "@/localisation/localisation";
import { appLog, flushAppLogNow } from "@/log/appLog";
import { connectivityNow } from "@/native/waveNative";
import { WaveSelfInstall } from "@/native/waveSelfInstall";
import { isNowPlayingShown } from "@/nowPlaying/sheet";
import { showAlert } from "@/overlay/alert";
import { isOverlayOpen } from "@/overlay/overlay";
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
const lastInstallAskAt = keptTime("updates.lastInstallAskAt");
const lastInstallAt = keptTime("updates.lastInstallAt");

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

const fetchLatestApk = (url: string): Effect.Effect<LatestApk | null, unknown> =>
  Effect.tryPromise(async (signal) => {
    const response = await fetch(url, { signal });
    // The channel hasn't published one yet.
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`The service answered ${response.status}`);
    const apk = readLatestApk((await response.json()) as unknown);
    if (apk === null) throw new Error("Unreadable answer");
    return apk;
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
  return fetchLatestApk(url).pipe(
    Effect.map((latest): NativeUpdate => {
      latestApk = latest;
      if (latest === null) return "none";
      const installedVersion = installer.installedVersion();
      if (!nativeUpdateIsNew({ installedRuntimeVersion, installedVersion, latest })) return "none";
      return installer.hasApk(latest.version, latest.size) ? "downloaded" : "available";
    }),
  );
});

/** Asks once something else isn't up; it answers false when it didn't, so it asks again soon. */
const askInstallPermission = Effect.tryPromise(async () => {
  if (isNowPlayingShown() || isOverlayOpen()) return false;
  const strings = currentLocalisation().strings.whatsNew;
  const choice = await showAlert({
    title: strings.installTitle,
    message: strings.installMessage,
    action: { label: strings.installAllow },
    dismissLabel: strings.installNotNow,
  });
  // Coming back from Android's screen brings Wave to the front, which asks the policy again.
  if (choice === "action") WaveSelfInstall?.openPermissionScreen();
  return true;
});

const readInstallAccess = (): InstallAccess =>
  WaveSelfInstall?.installAccess() ?? "needsPermission";

/** It can only change while Wave is away, so it's read then and not at every player change. */
let installAccess: InstallAccess = "needsPermission";

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
      const { url, version, size } = needLatestApk();
      return WaveSelfInstall.downloadApk(url, version, size);
    }),
    askInstallPermission,
    installApk: Effect.tryPromise(() => {
      if (WaveSelfInstall === null) throw new Error("No installer in this build");
      // The install takes the waiting lines with it.
      flushAppLogNow();
      return WaveSelfInstall.install(needLatestApk().version);
    }),
  },
  surroundings: () => ({
    network: network(),
    playing: playerKeepsPlaying(playbackState.get()),
    visible: AppState.currentState === "active",
    installAccess,
  }),
  now: Date.now,
  lastCheckAt,
  lastInstallAskAt,
  lastInstallAt,
  log: (level, message) => appLog(level, "WaveUpdates", message),
});

let started = false;

/** Starts following the phone, once per JS runtime; a build with updates off does nothing. */
export const startAppUpdates = (): void => {
  if (started || !Updates.isEnabled) return;
  started = true;
  installAccess = readInstallAccess();
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
    installAccess = readInstallAccess();
    followPlayerIfHidden();
    runner.reconsider();
  });
  followPlayerIfHidden();
  runner.reconsider();
};
