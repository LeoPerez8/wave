/**
 * How a screen's sections mount across frames (#1355): the first frame draws
 * only those that start inside the viewport, and each following frame mounts
 * those starting within a viewport below what is already mounted, so content
 * is there before a scroll reaches it and no frame pays for the whole page.
 */
export type StagedMountsInput = {
  /** Each section's estimated height, in order. */
  readonly estimates: readonly number[];
  /** The visible height the screen scrolls in. */
  readonly viewport: number;
  /** Room between sections. */
  readonly gap?: number;
};

/**
 * The number of sections mounted in each frame, cumulative, ending with all of
 * them. Every frame mounts at least one more, so a tall section can't stall
 * the rest.
 */
export const stagedMounts = ({ estimates, viewport, gap = 0 }: StagedMountsInput): number[] => {
  const counts: number[] = [];
  let mounted = 0;
  let bottom = 0;
  let limit = viewport;
  while (mounted < estimates.length) {
    let top = mounted === 0 ? 0 : bottom + gap;
    do {
      bottom = top + (estimates[mounted] ?? 0);
      top = bottom + gap;
      mounted++;
    } while (mounted < estimates.length && top < limit);
    counts.push(mounted);
    limit = bottom + viewport;
  }
  return counts.length === 0 ? [0] : counts;
};
