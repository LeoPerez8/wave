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

export type PagerMountsInput = {
  /** How many pages the row holds. */
  readonly count: number;
  /** The page in sight as the row first draws. */
  readonly index: number;
};

/**
 * How a sideways pager's pages mount across frames (#1380): the first frame
 * draws only the page in sight, and each following frame the pages one step
 * further out on both sides, so a swipe finds its next page already there.
 * `order` is the pages in the order they mount, and `counts` how many of
 * them are mounted in each frame, cumulative, ending with all of them.
 */
export const pagerMounts = ({
  count,
  index,
}: PagerMountsInput): {
  order: number[];
  counts: number[];
} => {
  if (count <= 0) return { order: [], counts: [0] };
  const first = Math.min(count - 1, Math.max(0, index));
  const order = [first];
  const counts = [1];
  for (let step = 1; order.length < count; step++) {
    if (first - step >= 0) order.push(first - step);
    if (first + step < count) order.push(first + step);
    counts.push(order.length);
  }
  return { order, counts };
};

export type ListMountsInput = {
  /** How many rows the list holds. */
  readonly count: number;
  /** How many rows one frame can mount within its budget. */
  readonly perFrame: number;
  /** About how many rows fill the screen. */
  readonly screen: number;
};

/**
 * How many of a virtualized list's rows it is given in each frame, cumulative,
 * ending with all of them (#1442). The list mounts only the rows on screen,
 * but its first frame would mount a whole screen of them at once; so it grows
 * by `perFrame` rows a frame until about a screen's worth is there, then takes
 * the rest, which it leaves unmounted until a scroll reaches them.
 */
export const listMounts = ({ count, perFrame, screen }: ListMountsInput): number[] => {
  const step = Math.max(1, perFrame);
  const counts: number[] = [];
  for (let mounted = step; mounted < count && mounted < screen; mounted += step)
    counts.push(mounted);
  counts.push(Math.max(0, count));
  return counts;
};
