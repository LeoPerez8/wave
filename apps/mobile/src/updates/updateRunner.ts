import {
  nextUpdateStep,
  type LogLevel,
  type NativeUpdate,
  type UpdateState,
  type UpdateStep,
} from "@wave/core";
import * as Cause from "effect/Cause";
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
  /** Fetches the APK the last check found; false when what came isn't the file CI signed. */
  readonly downloadApk: Effect.Effect<boolean, unknown>;
  /** Asks for the install permission; false when something was in the way and it didn't ask. */
  readonly askInstallPermission: Effect.Effect<boolean, unknown>;
  /** Hands the APK to Android, which ends this process when it installs. */
  readonly installApk: Effect.Effect<void, unknown>;
  /** The version the last check found on the channel, if any. */
  readonly offeredApkVersion: () => string | null;
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
  /** Kept across launches, so a reopened Wave doesn't fetch again what just came to nothing. */
  readonly lastApkAttempt: {
    readonly get: () => UpdateState["lastApkAttempt"];
    readonly set: (attempt: NonNullable<UpdateState["lastApkAttempt"]>) => void;
  };
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
  lastApkAttempt,
  log,
}: UpdateRunnerOptions) => {
  let working = false;
  let bundleAvailable = false;
  let bundleDownloaded = false;
  let nativeUpdate: NativeUpdate = "none";

  const noteApkAttempt = (): void => {
    const version = client.offeredApkVersion();
    if (version !== null) lastApkAttempt.set({ version, at: now() });
  };

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
      Effect.map((isSigned) => {
        if (isSigned) {
          nativeUpdate = "downloaded";
          log("info", "Downloaded the APK");
        } else {
          // A later try would fetch the same file, so the policy holds this version off.
          noteApkAttempt();
          nativeUpdate = "available";
          log("warn", "The downloaded APK isn't the file CI signed");
        }
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
      // Android's refusal only reaches the app log, and it may take the file with it. A version
      // that installed isn't offered again, so the policy reads this as a failure only if it is.
      noteApkAttempt();
      log("info", "Installing the APK");
      return client.installApk;
    }).pipe(
      // Android answers in the app log, and on success this process is gone. A later try waits
      // out the policy's interval.
      Effect.as(false),
      Effect.catch((error) =>
        Effect.sync(() => {
          log("warn", `The APK install failed: ${reason(error)}`);
          // The file may be gone. The next check says, and the policy holds off a new download.
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
      offeredApkVersion: client.offeredApkVersion(),
      lastApkAttempt: lastApkAttempt.get(),
      nativeUpdate,
      working,
      bundleAvailable,
      bundleDownloaded,
    });
    if (step === "wait") return;
    working = true;
    const guarded = steps[step].pipe(
      // A throw from native code in a step is a defect, which the steps' catches don't see. Waiting
      // for the next change is all that's left, and it mustn't leave `working` on for good.
      Effect.catchCause((cause) =>
        Effect.sync(() => {
          log("warn", `The ${step} step stopped: ${reason(Cause.squash(cause))}`);
          return false;
        }),
      ),
    );
    void Effect.runPromise(guarded).then((goOn) => {
      working = false;
      if (goOn) reconsider();
    });
  };

  return { reconsider };
};
