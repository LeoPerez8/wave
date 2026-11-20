/**
 * DJ's Done button (docs/spec.md, DJ): it loads while the session's first
 * batch is read, closes DJ once the queue plays, and leaves a quiet line with
 * Try Again when the batch comes back empty or can't be read.
 */
import type { DjStart } from "@/playback/MagicQueue";

/** What Done shows: nothing, its loading state, or the line of a batch that was empty or failed. */
export type DjDone = "idle" | "loading" | Exclude<DjStart, "started">;

/**
 * Runs Done, or Try Again, from [state]: [start] reads the first batch and
 * plays it. A tap while one is loading starts nothing. DJ closes ([close])
 * only when the queue started; a start that throws counts as failed.
 */
export const runDjDone = async (
  state: DjDone,
  start: () => Promise<DjStart>,
  set: (state: DjDone) => void,
  close: () => void,
): Promise<void> => {
  if (state === "loading") return;
  set("loading");
  const outcome = await start().catch((): DjStart => "failed");
  if (outcome === "started") close();
  else set(outcome);
};
