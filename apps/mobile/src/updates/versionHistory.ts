/**
 * Settings › Version History's source (docs/spec.md, Build and CI): the channel's whole history from
 * the update service the manifest comes from, read once per JS runtime for Settings' row and again
 * each time the page opens. The last answer is kept on the phone (`updates.versionHistory`), so the
 * row and the page start from it and keep it when the service doesn't answer. A build with updates
 * off has no address, so with nothing kept its page says it couldn't load.
 */
import {
  keptVersionHistory,
  readKeptVersionHistory,
  readVersionHistory,
  versionHistorySummary,
  versionHistoryUrl,
  type DatedRelease,
  type LogLevel,
} from "@wave/core";
import * as Effect from "effect/Effect";
import Constants from "expo-constants";
import { Storage } from "expo-sqlite/kv-store";
import * as Updates from "expo-updates";
import { useEffect, useSyncExternalStore } from "react";

import { useLocalisation } from "@/localisation/localisation";
import { appLog } from "@/log/appLog";

import { RUNNING_VERSION } from "./runningVersion";
import { createVersionHistoryStore, type VersionHistoryState } from "./versionHistoryStore";

/** How long the service gets to answer before it counts as a failure. */
const FETCH_TIMEOUT = "15 seconds";

/** The APK's channel, as What's New uses; null or "none" in a PR or local build. */
export const VERSION_HISTORY_CHANNEL: string | null = Updates.channel;

const fetchHistory = (): Effect.Effect<readonly DatedRelease[], unknown> =>
  Effect.gen(function* () {
    const url = versionHistoryUrl({
      manifestUrl: Constants.expoConfig?.updates?.url,
      channel: VERSION_HISTORY_CHANNEL,
    });
    if (url === null) return yield* Effect.fail(new Error("No address for the version history"));
    const answer = yield* Effect.tryPromise(async (signal) => {
      const response = await fetch(url, { signal });
      if (!response.ok) throw new Error(`The service answered ${response.status}`);
      return (await response.json()) as unknown;
    });
    const releases = readVersionHistory(answer);
    if (releases === null) return yield* Effect.fail(new Error("Unreadable version history"));
    return releases;
  }).pipe(Effect.timeout(FETCH_TIMEOUT));

/** Where the last answer is kept on this phone, never synced. */
const KEPT_KEY = "updates.versionHistory";

const log = (level: LogLevel, message: string): void => appLog(level, "WaveUpdates", message);

/** What the phone holds under `KEPT_KEY`, so an answer that changed nothing isn't written again. */
let keptText: string | null = null;

export const versionHistory = createVersionHistoryStore({
  fetchHistory,
  kept: {
    read: () => {
      keptText = Storage.getItemSync(KEPT_KEY);
      return readKeptVersionHistory(keptText);
    },
    write: (releases) => {
      const text = keptVersionHistory(releases);
      if (text === keptText) return;
      keptText = text;
      Storage.setItemAsync(KEPT_KEY, text).catch((error: unknown) =>
        log("warn", `Keeping the version history failed: ${String(error)}`),
      );
    },
  },
  log,
});

export const useVersionHistory = (): VersionHistoryState =>
  useSyncExternalStore(versionHistory.subscribe, versionHistory.get);

/** The Settings row's line: the running version's date, once the history has been read. */
export const useVersionHistorySummary = (): string | null => {
  const { language } = useLocalisation();
  const { status, releases } = useVersionHistory();
  useEffect(() => {
    if (status === "idle") versionHistory.load();
  }, [status]);
  return versionHistorySummary({
    releases,
    runningVersion: RUNNING_VERSION,
    channel: VERSION_HISTORY_CHANNEL,
    language,
  });
};
