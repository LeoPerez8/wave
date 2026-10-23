import { recapToAnnounce, type RecapPeriod } from "@wave/core";

/** No answer keeps Home's placeholder; an answered null removes the card's place. */
export const recapAnnouncement = (
  recaps: readonly RecapPeriod[] | undefined,
  opened: readonly string[],
): RecapPeriod | null | undefined =>
  recaps === undefined ? undefined : recapToAnnounce(recaps, opened);

/** Padding, two gaps and room for a two-line ready label at larger text sizes. */
export const recapCardHeight = (fontScale: number): number => 40 + 84 * Math.max(1, fontScale);
