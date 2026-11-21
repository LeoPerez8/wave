/**
 * DJ's Play pill, which this module still calls Done (docs/spec.md, DJ): it
 * loads while the session's first batch is read, closes DJ once the queue
 * plays, and leaves a quiet line with Try Again when the batch comes back
 * empty or can't be read.
 */
import type { DjStart } from "@/playback/MagicQueue";

/** What Done shows: nothing, its loading state, or the line of a batch that was empty or failed. */
export type DjDone = "idle" | "loading" | Exclude<DjStart, "started">;

/** Done for one opening of DJ: one start at a time, and none once DJ closed. */
export type DjDoneRunner = {
  /**
   * Runs Done, or Try Again: [start] reads the first batch and plays it,
   * unless the signal it's given aborts first. A tap while a start is loading
   * starts nothing, however quickly it follows. DJ closes only when the queue
   * started; a start that throws counts as failed.
   */
  run: (start: (signal: AbortSignal) => Promise<DjStart>) => Promise<void>;
  /** DJ closed: the start still loading is aborted, and nothing it returns reaches the screen. */
  cancel: () => void;
};

/** Runs the queue commit only when DJ was still open at the ready-song boundary. */
export const djStartWhileOpen = <A>(signal: AbortSignal | undefined, begin: () => A): A | null =>
  signal?.aborted === true ? null : begin();

/** A detached first-batch read can resume only the DJ session it started for. */
export const djBatchReadMayResume = (
  readSessionId: string,
  activeSessionId: string | null,
): boolean => readSessionId === activeSessionId;

/** Done for an opening of DJ, which shows its state with [set] and closes with [close]. */
export const djDone = (set: (state: DjDone) => void, close: () => void): DjDoneRunner => {
  const closed = new AbortController();
  let loading = false;
  return {
    run: async (start) => {
      if (loading || closed.signal.aborted) return;
      loading = true;
      set("loading");
      const outcome = await start(closed.signal).catch((): DjStart => "failed");
      loading = false;
      if (closed.signal.aborted) return;
      if (outcome === "started") close();
      else set(outcome);
    },
    cancel: () => closed.abort(),
  };
};
