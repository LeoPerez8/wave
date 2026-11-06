/**
 * Settings › Version History's source (docs/spec.md, Build and CI): the channel's whole history from
 * the update service the manifest comes from, read once per JS runtime for Settings' row and again
 * each time the page opens. A build with updates off has no address, so its page says it couldn't
 * load.
 */
import {
  readVersionHistory,
  versionHistorySummary,
  versionHistoryUrl,
  type DatedRelease,
} from "@wave/core";
import * as Effect from "effect/Effect";
import Constants from "expo-constants";
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

export const versionHistory = createVersionHistoryStore({
  fetchHistory,
  log: (level, message) => appLog(level, "WaveUpdates", message),
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
