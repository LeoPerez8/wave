import { nextUpdateStep, type LogLevel, type UpdateState, type UpdateStep } from "@wave/core";
import * as Effect from "effect/Effect";

/** The update service, as far as the runner needs it. */
export interface UpdateClient {
  /** Whether the service has a bundle this APK doesn't run yet. */
  readonly check: Effect.Effect<boolean, unknown>;
  /** Fetches it; whether that left something new to run. */
  readonly download: Effect.Effect<boolean, unknown>;
  /** Restarts the JS on the downloaded bundle, which ends this runtime when it works. */
  readonly apply: Effect.Effect<void, unknown>;
}

/** What the policy reads from the phone, as it stands when asked. */
export type UpdateSurroundings = Pick<UpdateState, "network" | "playing" | "visible">;

export interface UpdateRunnerOptions {
  readonly client: UpdateClient;
  readonly surroundings: () => UpdateSurroundings;
  readonly now: () => number;
  /** Kept across launches, so a reopened Wave doesn't check again inside the interval. */
  readonly lastCheckAt: {
    readonly get: () => number | null;
    readonly set: (at: number) => void;
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
  log,
}: UpdateRunnerOptions) => {
  let working = false;
  let bundleAvailable = false;
  let bundleDownloaded = false;

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
  };

  const reconsider = (): void => {
    const step = nextUpdateStep({
      ...surroundings(),
      now: now(),
      lastCheckAt: lastCheckAt.get(),
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
