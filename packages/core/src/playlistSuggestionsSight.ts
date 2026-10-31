/** How long the suggestions section, once in sight, took to show its offers (ms). */
export interface PlaylistSuggestionsSightTiming {
  readonly ms: number;
  readonly settleMs: number;
  readonly readMs: number;
  readonly rankMs: number;
  readonly offers: number;
  readonly failed: boolean;
}

// not UI text: times for the app log
const roundMs = (ms: number) => `${Math.round(ms)} ms`;

/** [timing] as one log line, under `WaveTiming`. */
// not UI text: the app log's line
export const playlistSuggestionsSightLine = ({
  ms,
  settleMs,
  readMs,
  rankMs,
  offers,
  failed,
}: PlaylistSuggestionsSightTiming): string => {
  const parts = `(settle ${roundMs(settleMs)}, read ${roundMs(readMs)}, rank ${roundMs(rankMs)})`;
  const shown = failed ? "failed" : `${offers} ${offers === 1 ? "offer" : "offers"}`;
  return `Playlist suggestions in sight: ${shown} after ${roundMs(ms)} ${parts}`;
};

/** The waits the section's offers go through. */
export type PlaylistSuggestionsWait = "settle" | "read" | "rank";

/**
 * Times one section's wait, once: from its first coming into sight until its
 * offers (or their failure) showed. Time before it came into sight counts for
 * nothing, so offers already showing make a wait of 0 ms.
 */
export const playlistSuggestionsSightWatch = (options: {
  readonly now: () => number;
  readonly report: (timing: PlaylistSuggestionsSightTiming) => void;
}) => {
  const spans: { wait: PlaylistSuggestionsWait; from: number; to: number }[] = [];
  let running: { wait: PlaylistSuggestionsWait; from: number } | null = null;
  let sightAt: number | null = null;
  let end: { at: number; offers: number; failed: boolean } | null = null;
  let reported = false;
  const reportIfDue = () => {
    if (reported || sightAt === null || end === null) return;
    reported = true;
    const start = sightAt;
    const stop = Math.max(start, end.at);
    const part = (wait: PlaylistSuggestionsWait) =>
      spans
        .filter((span) => span.wait === wait)
        .reduce(
          (ms, span) => ms + Math.max(0, Math.min(span.to, stop) - Math.max(span.from, start)),
          0,
        );
    options.report({
      ms: stop - start,
      settleMs: part("settle"),
      readMs: part("read"),
      rankMs: part("rank"),
      offers: end.offers,
      failed: end.failed,
    });
  };
  return {
    /** [wait] starts, ending the one running; null, none runs. */
    waiting: (wait: PlaylistSuggestionsWait | null): void => {
      if (end !== null) return;
      const at = options.now();
      if (running !== null) spans.push({ ...running, to: at });
      running = wait === null ? null : { wait, from: at };
    },
    /** The section came into sight, at [at] when that was noticed earlier. */
    inSight: (at: number = options.now()): void => {
      if (sightAt !== null) return;
      sightAt = at;
      reportIfDue();
    },
    /** The screen went out of sight: a wait under way counts from the section's next coming into sight. */
    hidden: (): void => {
      if (!reported) sightAt = null;
    },
    /** Its offers, or their failure, are showing now. */
    shown: (shown: { readonly offers: number; readonly failed: boolean }): void => {
      if (end !== null) return;
      const at = options.now();
      if (running !== null) spans.push({ ...running, to: at });
      running = null;
      end = { at, ...shown };
      reportIfDue();
    },
  };
};
