/**
 * A song's two marks across devices (docs/spec.md, "What syncs"): the star
 * and the dislike sync as separate rows, each merged by `mergeRows`, so a
 * song starred on one device and disliked on another comes out of a sync
 * with both. Decided here which one stays; the app writes the removal.
 */

/** When a mark last changed and on which device (`SyncRow` without its id). */
export interface MarkStamp {
  readonly changedAt: number;
  readonly phoneId: string;
}

/** What `settleMarks` gives. */
export interface SettledMarks {
  /** The mark that goes. */
  readonly removed: "favorite" | "dislike";
  /**
   * The stamp its removal carries: the kept mark's. Every device that
   * settles the pair writes the same tombstone, and the removed mark set
   * again afterwards is a later change that wins.
   */
  readonly removal: MarkStamp;
}

/**
 * Which mark stays on a song a sync left both starred ([favorite]) and
 * disliked ([dislike]): the one set later, the greater phone id (compared as
 * text) when they were set at the same time, as `mergeRows` breaks a tie, and
 * the dislike when one device set both at once.
 */
export const settleMarks = (favorite: MarkStamp, dislike: MarkStamp): SettledMarks => {
  const starWins =
    favorite.changedAt !== dislike.changedAt
      ? favorite.changedAt > dislike.changedAt
      : favorite.phoneId > dislike.phoneId;
  const kept = starWins ? favorite : dislike;
  return {
    removed: starWins ? "dislike" : "favorite",
    removal: { changedAt: kept.changedAt, phoneId: kept.phoneId },
  };
};
