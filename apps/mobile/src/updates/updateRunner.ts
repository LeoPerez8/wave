import {
  afterApkDownload,
  afterRequestedCheck,
  installTapAfter,
  installTapWhenHandoverEnds,
  nextUpdateStep,
  offeredApk,
  stoppedStepNotice,
  strandedUpdateRequest,
  updateButtonAction,
  updateButtonLook,
  updateRequestAfter,
  type InstallTap,
  type LogLevel,
  type NativeUpdate,
  type UpdateButtonLook,
  type UpdateNotice,
  type UpdateRequest,
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
  /**
   * Fetches the APK the last check found; false when what came isn't the file CI signed. Only a yes
   * to `askMobileData` gives [allowMetered].
   */
  readonly downloadApk: (allowMetered: boolean) => Effect.Effect<boolean, unknown>;
  /** Whether the person lets this download use mobile data. */
  readonly askMobileData: Effect.Effect<boolean, unknown>;
  /** Opens Android's "install from this source" screen. */
  readonly openInstallPermission: Effect.Effect<void, unknown>;
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
  /** Kept across launches, so a reopened Wave doesn't fetch again what just came to nothing. */
  readonly lastApkAttempt: {
    readonly get: () => UpdateState["lastApkAttempt"];
    readonly set: (attempt: NonNullable<UpdateState["lastApkAttempt"]>) => void;
  };
  readonly log: (level: LogLevel, message: string) => void;
  /** Tells the person something they asked about, or an install, came to this. */
  readonly report: (notice: UpdateNotice) => void;
}

const reason = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/**
 * Carries out Core's update policy (`nextUpdateStep`). Nothing ticks: it acts when told something
 * changed (`reconsider`) and when a step ends. A failure goes to the log, and whatever failed comes
 * round again by the policy's own rules; only one the person asked about, or an install, is reported.
 */
export const createUpdateRunner = ({
  client,
  surroundings,
  now,
  lastCheckAt,
  lastApkAttempt,
  log,
  report,
}: UpdateRunnerOptions) => {
  let bundleAvailable = false;
  let bundleDownloaded = false;
  let nativeUpdate: NativeUpdate = "none";
  let installTap: InstallTap = "none";
  let apkChecked = false;
  let updateRequest: UpdateRequest = "none";
  /** The running check started for the button's request, so it's the one to answer it. */
  let checkAnswersRequest = false;
  let checkFailed = false;
  let meteredAllowed = false;
  /** Set for as long as an APK download runs. */
  let downloadPercent: number | null = null;
  const listeners = new Set<() => void>();

  const notify = (): void => {
    for (const listener of listeners) listener();
  };

  const endRequest = (notice: UpdateNotice | null): void => {
    updateRequest = "none";
    checkAnswersRequest = false;
    meteredAllowed = false;
    if (notice !== null) report(notice);
  };

  const endDownload = (download: "signed" | "failed"): void => {
    const { visible } = surroundings();
    const { tapped, outcome } = afterApkDownload({ download, updateRequest, visible });
    if (tapped) installTap = "tapped";
    endRequest(outcome);
  };

  const failInstall = (): void => {
    installTap = "none";
    report("installFailed");
  };

  const answerRequestedCheck = (): void => {
    if (!checkAnswersRequest) return;
    checkAnswersRequest = false;
    const { network, visible } = surroundings();
    const { next, outcome } = afterRequestedCheck({
      visible,
      nativeUpdate,
      network,
      bundleAvailable,
      bundleDownloaded,
      checkFailed,
    });
    switch (next) {
      case "install":
        installTap = "tapped";
        endRequest(null);
        return;
      case "none":
        endRequest(outcome);
        return;
      case "askMobileData":
      case "download":
        updateRequest = next;
    }
  };

  const noteApkAttempt = (): void => {
    const version = client.offeredApkVersion();
    if (version !== null) lastApkAttempt.set({ version, at: now() });
  };

  // On its own, so a service that fails one question still answers the other.
  const checkNative = client.checkNative.pipe(
    Effect.map((found) => {
      if (found !== nativeUpdate) log("info", `The channel's APK: ${found}`);
      nativeUpdate = found;
      // The tap was for a file that's gone; a later download waits for one of its own.
      if (found !== "downloaded") installTap = "none";
    }),
    Effect.catch((error) =>
      Effect.sync(() => {
        checkFailed = true;
        log("warn", `The APK check failed: ${reason(error)}`);
      }),
    ),
  );

  const steps: Record<Exclude<UpdateStep, "wait">, Effect.Effect<boolean>> = {
    check: Effect.suspend(() => {
      checkAnswersRequest = updateRequest === "check";
      checkFailed = false;
      lastCheckAt.set(now());
      apkChecked = true;
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
          checkFailed = true;
          log("warn", `The update check failed: ${reason(error)}`);
          return true;
        }),
      ),
      Effect.andThen((goOn) => checkNative.pipe(Effect.as(goOn))),
      Effect.tap(() => Effect.sync(answerRequestedCheck)),
    ),
    askMobileData: Effect.suspend(() => client.askMobileData).pipe(
      Effect.map((allowed) => {
        meteredAllowed = allowed;
        if (allowed) updateRequest = "download";
        else endRequest(null);
        return true;
      }),
      Effect.catch((error) =>
        Effect.sync(() => {
          log("warn", `Asking about mobile data failed: ${reason(error)}`);
          endRequest("downloadFailed");
          return true;
        }),
      ),
    ),
    checkApk: Effect.suspend(() => {
      apkChecked = true;
      return checkNative.pipe(Effect.as(true));
    }),
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
      downloadPercent = 0;
      notify();
      return client.downloadApk(meteredAllowed);
    }).pipe(
      Effect.map((isSigned) => {
        if (isSigned) {
          nativeUpdate = "downloaded";
          log("info", "Downloaded the APK");
          endDownload("signed");
        } else {
          // A later try would fetch the same file, so the policy holds this version off.
          noteApkAttempt();
          nativeUpdate = "available";
          log("warn", "The downloaded APK isn't the file CI signed");
          endDownload("failed");
        }
        return true;
      }),
      Effect.catch((error) =>
        Effect.sync(() => {
          log("warn", `The APK download failed: ${reason(error)}`);
          // The next check finds it again.
          nativeUpdate = "none";
          endDownload("failed");
          return true;
        }),
      ),
      Effect.ensuring(Effect.sync(() => (downloadPercent = null))),
    ),
    openInstallPermission: Effect.suspend(() => {
      // Before the call: Wave can leave for the screen before the call has answered.
      installTap = "atPermissionScreen";
      log("info", "Opening the install permission screen");
      return client.openInstallPermission;
    }).pipe(
      // Coming back brings Wave to the front, which asks the policy again.
      Effect.as(false),
      Effect.catch((error) =>
        Effect.sync(() => {
          log("warn", `Opening the install permission screen failed: ${reason(error)}`);
          failInstall();
          return false;
        }),
      ),
    ),
    installApk: Effect.suspend(() => {
      installTap = "handedOver";
      // Android's refusal only reaches the app log, and it may take the file with it. A version
      // that installed isn't offered again, so the policy reads this as a failure only if it is.
      noteApkAttempt();
      log("info", "Installing the APK");
      return client.installApk;
    }).pipe(
      // Android answers in the app log, and on success this process is gone. A later try takes
      // another tap.
      Effect.as(false),
      Effect.catch((error) =>
        Effect.sync(() => {
          log("warn", `The APK install failed: ${reason(error)}`);
          // The file may be gone. The next check says, and the policy holds off a new download.
          nativeUpdate = "available";
          failInstall();
          return false;
        }),
      ),
    ),
  };

  let running: UpdateStep | null = null;

  let look: UpdateButtonLook = "idle";

  const reconsider = (): void => {
    const around = surroundings();
    const tap = installTapAfter(installTap, around);
    const request = updateRequestAfter(updateRequest, around);
    if (tap !== installTap || request !== updateRequest) {
      installTap = tap;
      if (request === "none") endRequest(null);
      notify();
    }
    const stranded = running === null ? strandedUpdateRequest(updateRequest, around.network) : null;
    if (stranded !== null) {
      endRequest(stranded);
      notify();
    }
    const step = nextUpdateStep({
      ...around,
      now: now(),
      lastCheckAt: lastCheckAt.get(),
      installTap,
      apkChecked,
      offeredApkVersion: client.offeredApkVersion(),
      lastApkAttempt: lastApkAttempt.get(),
      updateRequest,
      nativeUpdate,
      working: running !== null,
      bundleAvailable,
      bundleDownloaded,
    });
    if (step === "wait") return;
    running = step;
    const guarded = steps[step].pipe(
      // A throw from native code in a step is a defect, which the steps' catches don't see. Waiting
      // for the next change is all that's left, and it mustn't leave `running` set for good.
      Effect.catchCause((cause) =>
        Effect.sync(() => {
          log("warn", `The ${step} step stopped: ${reason(Cause.squash(cause))}`);
          installTap = "none";
          endRequest(stoppedStepNotice({ step, updateRequest }));
          return false;
        }),
      ),
    );
    void Effect.runPromise(guarded).then((goOn) => {
      running = null;
      notify();
      // A tap made while the step ran is owed its answer now, whatever the step would do next.
      if (goOn || installTap === "tapped" || updateRequest !== "none") reconsider();
    });
  };

  /** The version a tap would install; null with none ready or a tap under way. */
  const offeredVersion = (): string | null =>
    offeredApk({ nativeUpdate, offeredApkVersion: client.offeredApkVersion(), installTap });

  const requestInstall = (): void => {
    if (offeredVersion() === null) return;
    installTap = "tapped";
    notify();
  };

  return {
    reconsider,
    offeredVersion,
    /**
     * A tap on the offer. Nothing installs but from a tap: this, or what the update button asked for
     * when its check or download ends. Call `reconsider` after.
     */
    requestInstall,
    /** A tap on the update button in Settings. Call `reconsider` after it. */
    tapUpdateButton: (): void => {
      switch (
        updateButtonAction({
          nativeUpdate,
          installTap,
          updateRequest,
          downloadingApk: running === "downloadApk",
        })
      ) {
        case "install":
          requestInstall();
          return;
        case "check":
          updateRequest = "check";
          notify();
          return;
        case "followDownload":
          updateRequest = "download";
          return;
        case "none":
      }
    },
    /** The same object while it says the same, as `useSyncExternalStore` needs. */
    buttonLook: (): UpdateButtonLook => {
      const next = updateButtonLook({ updateRequest, downloadPercent });
      const unchanged =
        typeof next === "object" && typeof look === "object"
          ? next.downloading === look.downloading
          : next === look;
      if (!unchanged) look = next;
      return look;
    },
    /** How far the running APK download has got. */
    downloadProgress: (percent: number): void => {
      if (downloadPercent === null) return;
      downloadPercent = percent;
      notify();
    },
    /** Android turned down an install after taking the APK, and deleted the file. */
    installRefused: (): void => {
      nativeUpdate = "available";
      failInstall();
      notify();
    },
    /**
     * Android's installer let go of the APK and kept the file: the session was declined or dropped,
     * or its confirmation couldn't show, which is the one that's [failed].
     */
    installAbandoned: (failed: boolean): void => {
      installTap = installTapWhenHandoverEnds(installTap);
      if (failed) report("installFailed");
      notify();
    },
    /** Wave has come back to the front, so an install still handed over is one that went nowhere. */
    cameToFront: (): void => {
      installTap = installTapWhenHandoverEnds(installTap);
      notify();
    },
    subscribe: (listener: () => void): (() => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
};
