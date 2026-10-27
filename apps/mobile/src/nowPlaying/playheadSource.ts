import type { PositionReport, SleepTimer } from "@wave/core";

interface Source<T> {
  readonly get: () => T;
  readonly subscribe: (listener: () => void) => () => void;
}

/** The platform adapters for the one Now Playing playhead. */
export interface PlayheadSources {
  readonly reports: Source<PositionReport>;
  readonly shown: Source<boolean>;
  readonly active: Source<boolean>;
  readonly timer: Source<SleepTimer | null>;
}

interface PlayheadOutput {
  readonly report: (report: PositionReport, now: number) => void;
  readonly live: (live: boolean) => void;
  readonly ticking: (ticking: boolean) => void;
}

/** Follow playback only while visible; publish a fresh report before restarting UI frames. */
export const observePlayhead = (
  sources: PlayheadSources,
  output: PlayheadOutput,
  now: () => number = Date.now,
): (() => void) => {
  let stopReports: (() => void) | undefined;
  let stopTimer: (() => void) | undefined;
  const update = (): void => {
    output.report(sources.reports.get(), now());
    output.ticking(sources.reports.get().isPlaying || sources.timer.get()?.type === "deadline");
  };
  const visibility = (): void => {
    const live = sources.shown.get() && sources.active.get();
    if (!live) {
      output.live(false);
      output.ticking(false);
      stopReports?.();
      stopTimer?.();
      stopReports = undefined;
      stopTimer = undefined;
    } else if (stopReports === undefined) {
      stopReports = sources.reports.subscribe(update);
      stopTimer = sources.timer.subscribe(update);
      update();
      output.live(true);
    }
  };
  const stopShown = sources.shown.subscribe(visibility);
  const stopActive = sources.active.subscribe(visibility);
  visibility();
  return () => {
    output.live(false);
    output.ticking(false);
    stopReports?.();
    stopTimer?.();
    stopShown();
    stopActive();
  };
};
