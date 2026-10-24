/**
 * When Now Playing's favorite star pops (docs/spec.md, Mini player and Now
 * Playing): it fills with a short pop when a tap on it or a double-tap on
 * the cover favorites the song, so the change registers where the state
 * lives. A song that loads as a favorite, or a star emptied, doesn't pop.
 */

export interface StarPop {
  /** A tap on the empty star or a double-tap on the cover asked to fill [song]'s star. */
  readonly ask: (song: string) => void;
  /**
   * The star shows [song], [filled] or not; says whether it pops now: the
   * first time it shows filled the song a fill was asked for. Showing
   * another song forgets the fill asked for.
   */
  readonly show: (song: string | null, filled: boolean) => boolean;
}

export const createStarPop = (): StarPop => {
  /** The song whose fill was asked for and hasn't shown yet. */
  let asked: string | null = null;
  return {
    ask: (song) => {
      asked = song;
    },
    show: (song, filled) => {
      if (song !== asked) {
        asked = null;
        return false;
      }
      if (!filled) return false;
      asked = null;
      return true;
    },
  };
};
