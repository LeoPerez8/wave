/**
 * Over-the-air updates arriving unnoticed (docs/spec.md, Build and CI): connects the update runner
 * to `expo-updates`, the phone's state and the app log. Wave asks when it comes to the front or
 * leaves it, and in the background when the player changes; it holds no timer.
 */
import { playerKeepsPlaying, type UpdateNetwork } from "@wave/core";
import * as Effect from "effect/Effect";
import * as Updates from "expo-updates";
import { AppState } from "react-native";

import { persistedSetting } from "@/lib/persistedSetting";
import { appLog, flushAppLogNow } from "@/log/appLog";
import { connectivityNow } from "@/native/waveNative";
import { playbackState } from "@/playback/Player";

import { createUpdateRunner } from "./updateRunner";

const lastCheckAt = persistedSetting<number | null>({
  key: "updates.lastCheckAt",
  read: (stored) => {
    const at = stored === null ? NaN : Number(stored);
    return Number.isFinite(at) ? at : null;
  },
  write: (at) => (at === null ? null : String(at)),
});

const network = (): UpdateNetwork => {
  const { online, onMobileData } = connectivityNow();
  if (!online) return "none";
  return onMobileData ? "metered" : "unmetered";
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
  },
  surroundings: () => ({
    network: network(),
    playing: playerKeepsPlaying(playbackState.get()),
    visible: AppState.currentState === "active",
  }),
  now: Date.now,
  lastCheckAt,
  log: (level, message) => appLog(level, "WaveUpdates", message),
});

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
    runner.reconsider();
  });
  followPlayerIfHidden();
  runner.reconsider();
};
