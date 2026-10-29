/**
 * The trailing cell of a track row. A ranking by plays (Home's Most Played,
 * an artist's Most played, Stats' song rankings) leads with plays, so its rows
 * show the counted plays the ranking was ordered by; every other list shows
 * the song's length.
 */

import { catalogueOf, type AppLanguage } from "./localisation.ts";
import { formatDuration } from "./time.ts";

export interface TrackRowTrailingInput {
  /** Null when unknown (a YT Music song that doesn't say): the cell stays empty. */
  readonly durationMs: number | null;
  /** The song's counted plays, on a ranking by plays only. */
  readonly countedPlays?: number | undefined;
}

/**
 * "12 plays" / "1 play" (in [language]) on a ranking by plays, else the
 * length ("3:07"), or nothing when unknown.
 */
export const trackRowTrailing = (
  { durationMs, countedPlays }: TrackRowTrailingInput,
  language: AppLanguage = "en",
): string => {
  if (countedPlays !== undefined) return catalogueOf(language).stats.plays(countedPlays);
  return durationMs === null ? "" : formatDuration(durationMs);
};
