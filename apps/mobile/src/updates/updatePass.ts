import {
  UPDATE_PASS_HEADER,
  WAVE_UPDATES_ORIGIN,
  readUpdatePass,
  type WaveSession,
} from "@wave/core";
import * as Effect from "effect/Effect";
import Constants from "expo-constants";
import * as Updates from "expo-updates";

import { persistedSetting } from "@/lib/persistedSetting";
import { appLog } from "@/log/appLog";
import { WaveAccount } from "@/native/waveAccount";
import { askWaveService } from "@/sync/askWaveService";

import { createUpdatePassRunner } from "./updatePassRunner";

const kept = persistedSetting({
  key: "updates.accountPass",
  read: (stored) => {
    if (stored === null) return null;
    try {
      const value = JSON.parse(stored) as { account?: unknown; pass?: unknown } | null;
      const pass = readUpdatePass(value?.pass);
      return typeof value?.account === "string" && pass !== null
        ? { account: value.account, pass }
        : null;
    } catch {
      return null;
    }
  },
  write: (value) => (value === null ? null : JSON.stringify(value)),
});

const runner = createUpdatePassRunner({
  now: Date.now,
  requestPass: () => askWaveService("/v1/update-pass"),
  kept,
  channel:
    Constants.expoConfig?.updates?.url === `${WAVE_UPDATES_ORIGIN}/v1/manifest`
      ? Updates.channel
      : null,
  setExpoHeaders: (headers) => {
    if (Updates.isEnabled) Updates.setUpdateRequestHeadersOverride(headers);
  },
  warn: (message) => appLog("warn", "WaveUpdates", message),
});

let ready: Promise<void> | undefined;

const followAccount = (): Promise<void> => {
  if (ready === undefined) {
    let heard = false;
    const changed = (session: WaveSession) => {
      heard = true;
      runner.accountChanged(session.status === "signedIn" ? session.account.email : null);
    };
    WaveAccount.addListener("onSessionChanged", (session) => {
      changed(session);
      void runner.refresh();
    });
    ready = WaveAccount.session().then(
      (session) => {
        if (!heard) changed(session);
      },
      () => {
        if (!heard && Updates.isEnabled) {
          // Clear any override left by a previous JS runtime before making a public check.
          try {
            Updates.setUpdateRequestHeadersOverride(null);
          } catch {
            appLog("warn", "WaveUpdates", "Could not clear Expo update request headers");
          }
        }
      },
    );
  }
  return ready;
};

/** Let the first request use a pass if sync answers promptly. Renewal can finish in the background. */
export const prepareUpdatePass = (): Promise<void> =>
  Effect.runPromise(
    Effect.promise(async () => {
      await followAccount();
      const refreshing = runner.refresh();
      if (!runner.hasPass()) await refreshing;
    }).pipe(Effect.timeoutOption("3 seconds"), Effect.asVoid),
  );

export const withExpoUpdatePass = async <T>(request: () => Promise<T>): Promise<T> => {
  await prepareUpdatePass();
  return runner.withExpoHeaders(request);
};

export const fetchUpdateService = async (url: string, signal: AbortSignal): Promise<Response> => {
  await prepareUpdatePass();
  const headers = runner.headersFor(url);
  return fetch(url, {
    signal,
    headers,
    ...(UPDATE_PASS_HEADER in headers && { redirect: "error" }),
  });
};
