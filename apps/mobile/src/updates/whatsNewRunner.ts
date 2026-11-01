import {
  mergeReleaseNotes,
  nextWhatsNewStep,
  type LogLevel,
  type PublishedRelease,
} from "@wave/core";
import * as Effect from "effect/Effect";

/** What Core's step reads from the phone, as it stands when asked. */
export interface WhatsNewSurroundings {
  readonly visible: boolean;
  readonly nowPlayingShown: boolean;
  readonly cardOpen: boolean;
}

export interface WhatsNewRunnerOptions {
  readonly runningVersion: string | null;
  /** Kept across launches, and across a JS reload. */
  readonly seenVersion: {
    readonly get: () => string | null;
    readonly set: (version: string) => void;
  };
  readonly fetchNotes: (
    from: string,
    to: string,
  ) => Effect.Effect<readonly PublishedRelease[], unknown>;
  readonly surroundings: () => WhatsNewSurroundings;
  /** Opens the card; `dismissed` says the user is done with it. Gives what takes it down unseen. */
  readonly show: (releases: readonly PublishedRelease[], dismissed: () => void) => () => void;
  readonly now: () => number;
  readonly log: (level: LogLevel, message: string) => void;
  /** Nothing more can happen in this launch, so what follows the phone can stop. */
  readonly onFinished: () => void;
}

const reason = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/**
 * Carries out Core's `nextWhatsNewStep`. It acts when told something changed (`reconsider`) and
 * when a fetch ends. A failure only goes to the log.
 */
export const createWhatsNewRunner = ({
  runningVersion,
  seenVersion,
  fetchNotes,
  surroundings,
  show,
  now,
  log,
  onFinished,
}: WhatsNewRunnerOptions) => {
  let fetching = false;
  let notes: readonly PublishedRelease[] | null = null;
  let hide: (() => void) | null = null;
  let lastFailureAt: number | null = null;
  let finished = false;

  const finish = (): void => {
    if (finished) return;
    finished = true;
    onFinished();
  };

  const markSeen = (): void => {
    if (runningVersion !== null) seenVersion.set(runningVersion);
    finish();
  };

  const fetchThem = (from: string, to: string): void => {
    fetching = true;
    void Effect.runPromise(
      fetchNotes(from, to).pipe(
        Effect.map((releases) => {
          // Every language has the same lines or their English fallback.
          if (mergeReleaseNotes(releases, "en") !== null) notes = releases;
          else {
            log("info", `No release notes between ${from} and ${to}`);
            markSeen();
          }
        }),
        Effect.catch((error) =>
          Effect.sync(() => {
            lastFailureAt = now();
            log("warn", `The release notes fetch failed: ${reason(error)}`);
          }),
        ),
      ),
    ).then(() => {
      fetching = false;
      reconsider();
    });
  };

  const reconsider = (): void => {
    if (finished) return;
    const seen = seenVersion.get();
    const step = nextWhatsNewStep({
      ...surroundings(),
      runningVersion,
      seenVersion: seen,
      fetching,
      notesReady: notes !== null,
      showing: hide !== null,
      now: now(),
      lastFailureAt,
    });
    switch (step) {
      case "remember":
        markSeen();
        return;
      case "finished":
        finish();
        return;
      case "fetch":
        if (seen !== null && runningVersion !== null) fetchThem(seen, runningVersion);
        return;
      case "show":
        if (notes === null) return;
        hide = show(notes, () => {
          hide = null;
          markSeen();
        });
        return;
      case "hide": {
        // First, since taking it down has this asked again at once.
        const takeDown = hide;
        hide = null;
        takeDown?.();
        return;
      }
      case "wait":
        return;
    }
  };

  return { reconsider };
};
