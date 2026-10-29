/**
 * The daily Follows check while Wave is closed (#811): WorkManager, through
 * expo-background-task, runs the same check Home opening runs, with Core's
 * 24-hour window, and posts new shows' notifications as it does. Its runs
 * need any network.
 */
import * as BackgroundTask from "expo-background-task";
import * as TaskManager from "expo-task-manager";

import { appRuntime } from "@/library/runtime";

import { checkFollowReleases } from "./followReleases";

const FOLLOW_CHECK_TASK = "wave.followCheck";

// Defined as the bundle loads (index.ts imports it through services.ts), so a run that starts Wave headless
// finds it before the app's first screen, or with none.
TaskManager.defineTask(FOLLOW_CHECK_TASK, async () => {
  try {
    await appRuntime.runPromise(checkFollowReleases(undefined, "background"));
    return BackgroundTask.BackgroundTaskResult.Success;
  } catch (error) {
    console.warn("[wave] The daily Follows check failed", error);
    return BackgroundTask.BackgroundTaskResult.Failed;
  }
});

/**
 * Asks WorkManager for the daily check; once registered, asking again changes
 * nothing. It stays registered with the switch off or nothing followed: the
 * check then returns before any request.
 */
export const scheduleFollowCheck = (): void => {
  BackgroundTask.registerTaskAsync(FOLLOW_CHECK_TASK, { minimumInterval: 24 * 60 }).catch(
    (error: unknown) => console.warn("[wave] Couldn't schedule the daily Follows check", error),
  );
};
