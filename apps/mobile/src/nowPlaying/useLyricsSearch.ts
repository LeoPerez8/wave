import type { LyricsAnswer, LyricsSearchSong, LyricsSource } from "@wave/core";
import { useCallback, useEffect, useState } from "react";

import { askLyrics } from "./lyricsSources";

/** Where a search stands, as Core decides it from the answers so far. */
export type LyricsSearchStep<Shown> =
  | { readonly kind: "ask"; readonly source: LyricsSource }
  /** Done: what the view shows, and what to keep of it (saved lyrics, a miss, the file written). */
  | { readonly kind: "done"; readonly shown: Shown; readonly keep: (() => Promise<void>) | null };

/** A search ready to run: the song it asks about and Core's step. */
export interface LyricsSearchPlan<Shown> {
  readonly song: LyricsSearchSong;
  readonly step: (answers: readonly LyricsAnswer[]) => LyricsSearchStep<Shown>;
}

/**
 * Runs the Lyrics view's online search for [key] (what's shown belongs to:
 * a track, a file; null for no search): [begin] reads what the search starts
 * from (a plan, or what to show at once; a new [begin] searches again), then
 * the sources Core names are asked one at a time, showing [searching]
 * meanwhile, until Core says it's done. A view that moved on (another song,
 * closed) asks nothing more. Try again searches afresh and shows [searching]
 * at once, not the failure it's retrying. Shared by the non-D and Library
 * searches.
 */
export const useLyricsSearch = <Shown>(
  key: string | null,
  begin: (() => Promise<LyricsSearchPlan<Shown> | { readonly shown: Shown }>) | null,
  searching: Shown,
): { readonly shown: Shown | null; readonly retry: () => void } => {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<{
    readonly key: string;
    readonly attempt: number;
    readonly shown: Shown;
  } | null>(null);

  useEffect(() => {
    if (key === null || begin === null) return undefined;
    let current = true;
    const show = (shown: Shown): void => {
      if (current) setState({ key, attempt, shown });
    };
    void (async () => {
      const plan = await begin();
      if (!("step" in plan)) {
        show(plan.shown);
        return;
      }
      const answers: LyricsAnswer[] = [];
      for (;;) {
        const step = plan.step(answers);
        if (step.kind === "done") {
          show(step.shown);
          await step.keep?.();
          return;
        }
        show(searching);
        // Gone from the view: no more requests.
        if (!current) return;
        answers.push(await askLyrics(step.source, plan.song));
      }
    })();
    return () => {
      current = false;
    };
  }, [key, begin, searching, attempt]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  if (key === null || state?.key !== key) return { shown: null, retry };
  return { shown: state.attempt === attempt ? state.shown : searching, retry };
};
