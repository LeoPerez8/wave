import {
  nextUpdateStep,
  type LogLevel,
  type NativeUpdate,
  type UpdateState,
  type UpdateStep,
} from "@wave/core";
import * as Effect from "effect/Effect";

/** The update service, as far as the runner needs it. */
export interface UpdateClient {
  /** Whether the service has a bundle this APK doesn't run yet. */
  readonly check: Effect.Effect<boolean, unknown>;
  /** Fetches it; whether that left something new to run. */
  readonly download: Effect.Effect<boolean, unknown>;
  /** Restarts the JS on the downloaded bundle, which ends this runtime when it works. */
  readonly apply: Effect.Effect<void, unknown>;
  /** What the channel's newest APK means for this phone. */
  readonly checkNative: Effect.Effect<NativeUpdate, unknown>;
  /** Fetches the APK the last check found. */
  readonly downloadApk: Effect.Effect<void, unknown>;
  /** Asks for the install permission; false when something was in the way and it didn't ask. */
  readonly askInstallPermission: Effect.Effect<boolean, unknown>;
  /** Hands the APK to Android, which ends this process when it installs. */
  readonly installApk: Effect.Effect<void, unknown>;
}

/** A value kept across launches, so a reopened Wave doesn't repeat a step inside its interval. */
interface KeptTime {
  readonly get: () => number | null;
  readonly set: (at: number) => void;
}

/** What the policy reads from the phone, as it stands when asked. */
export type UpdateSurroundings = Pick<
  UpdateState,
  "network" | "playing" | "visible" | "installAccess"
>;

export interface UpdateRunnerOptions {
  readonly client: UpdateClient;
  readonly surroundings: () => UpdateSurroundings;
  readonly now: () => number;
  readonly lastCheckAt: KeptTime;
  readonly lastInstallAskAt: KeptTime;
  readonly lastInstallAt: KeptTime;
  readonly log: (level: LogLevel, message: string) => void;
}

const reason = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/**
 * Carries out Core's update policy (`nextUpdateStep`). Nothing ticks: it acts when told something
 * changed (`reconsider`) and when a step ends. A failure only goes to the log, and whatever failed
 * comes round again by the policy's own rules.
 */
export const createUpdateRunner = ({
  client,
  surroundings,
  now,
  lastCheckAt,
  lastInstallAskAt,
  lastInstallAt,
  log,
}: UpdateRunnerOptions) => {
  let working = false;
  let bundleAvailable = false;
  let bundleDownloaded = false;
  let nativeUpdate: NativeUpdate = "none";

  // On its own, so a service that fails one question still answers the other.
  const checkNative = client.checkNative.pipe(
    Effect.map((found) => {
      if (found !== nativeUpdate) log("info", `The channel's APK: ${found}`);
      nativeUpdate = found;
    }),
    Effect.catch((error) =>
      Effect.sync(() => log("warn", `The APK check failed: ${reason(error)}`)),
    ),
  );

  const steps: Record<Exclude<UpdateStep, "wait">, Effect.Effect<boolean>> = {
    check: Effect.suspend(() => {
      lastCheckAt.set(now());
      log("info", "Checking for an update");
      return client.check;
    }).pipe(
      Effect.map((available) => {
        bundleAvailable = available;
        log("info", available ? "An update is available" : "No update available");
        return true;
      }),
      Effect.catch((error) =>
        Effect.sync(() => {
          log("warn", `The update check failed: ${reason(error)}`);
          return true;
        }),
      ),
      Effect.andThen((goOn) => checkNative.pipe(Effect.as(goOn))),
    ),
    downloadBundle: Effect.suspend(() => {
      log("info", "Downloading the update");
      return client.download;
    }).pipe(
      Effect.map((isNew) => {
        bundleDownloaded ||= isNew;
        log("info", isNew ? "Downloaded the update" : "The download brought nothing new");
        return true;
      }),
      Effect.catch((error) =>
        Effect.sync(() => {
          log("warn", `The update download failed: ${reason(error)}`);
          return true;
        }),
      ),
      // Whatever came of it, the next check says what's still out there.
      Effect.ensuring(Effect.sync(() => (bundleAvailable = false))),
    ),
    applyBundle: Effect.suspend(() => {
      log("info", "Applying the downloaded update");
      return client.apply;
    }).pipe(
      Effect.map(() => {
        // The restart is on its way, and a change before it mustn't ask twice.
        bundleDownloaded = false;
        return false;
      }),
      // Not right away: it would only fail again, so it waits for the next change.
      Effect.catch((error) =>
        Effect.sync(() => {
          log("warn", `The update apply failed: ${reason(error)}`);
          return false;
        }),
      ),
    ),
    downloadApk: Effect.suspend(() => {
      log("info", "Downloading the APK");
      return client.downloadApk;
    }).pipe(
      Effect.map(() => {
        nativeUpdate = "downloaded";
        log("info", "Downloaded the APK");
        return true;
      }),
      Effect.catch((error) =>
        Effect.sync(() => {
          log("warn", `The APK download failed: ${reason(error)}`);
          // The next check finds it again.
          nativeUpdate = "none";
          return true;
        }),
      ),
    ),
    askInstallPermission: Effect.suspend(() => {
      log("info", "Asking for the install permission");
      return client.askInstallPermission;
    }).pipe(
      Effect.map((asked) => {
        if (asked) lastInstallAskAt.set(now());
        return false;
      }),
      Effect.catch((error) =>
        Effect.sync(() => {
          log("warn", `Asking for the install permission failed: ${reason(error)}`);
          return false;
        }),
      ),
    ),
    installApk: Effect.suspend(() => {
      lastInstallAt.set(now());
      log("info", "Installing the APK");
      return client.installApk;
    }).pipe(
      // Android answers in the app log, and on success this process is gone. A later try waits
      // out the policy's interval.
      Effect.as(false),
      Effect.catch((error) =>
        Effect.sync(() => {
          log("warn", `The APK install failed: ${reason(error)}`);
          // The file may be gone, so it goes through the download again, which reuses a whole one.
          nativeUpdate = "available";
          return false;
        }),
      ),
    ),
  };

  const reconsider = (): void => {
    const step = nextUpdateStep({
      ...surroundings(),
      now: now(),
      lastCheckAt: lastCheckAt.get(),
      lastInstallAskAt: lastInstallAskAt.get(),
      lastInstallAt: lastInstallAt.get(),
      nativeUpdate,
      working,
      bundleAvailable,
      bundleDownloaded,
    });
    if (step === "wait") return;
    working = true;
    void Effect.runPromise(steps[step]).then((goOn) => {
      working = false;
      if (goOn) reconsider();
    });
  };

  return { reconsider };
};
