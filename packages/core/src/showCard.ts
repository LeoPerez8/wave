/**
 * The date a show card leads with: a ticket stub's month, day and weekday,
 * the time when Ticketmaster gives one, and the whole of it as TalkBack reads it.
 */

import { formatDate, formatTime } from "./formatting.ts";
import type { AppLanguage } from "./localisation.ts";

export interface ShowCardDate {
  /** Short month, set in tracked caps on the stub ("Nov", "nov"). */
  readonly month: string;
  readonly day: string;
  readonly weekday: string;
  /** The local start time; null for a show Ticketmaster dates without one. */
  readonly time: string | null;
  readonly spoken: string;
}

/**
 * [startsAt] is a `FollowShow`'s. A date-only show reads as that day's
 * 23:59:59 local time (`ticketmasterShows`), so it shows no time.
 */
export const showCardDate = (language: AppLanguage, startsAt: string): ShowCardDate => {
  const date = new Date(startsAt);
  const time = startsAt.endsWith("T23:59:59") ? null : formatTime(language, date);
  const spoken = formatDate(language, date, { weekday: "long", month: "long", day: "numeric" });
  return {
    month: formatDate(language, date, { month: "short" }).replace(/\.$/, ""),
    day: formatDate(language, date, { day: "numeric" }),
    weekday: formatDate(language, date, { weekday: "short" }),
    time,
    spoken: time === null ? spoken : `${spoken}, ${time}`,
  };
};
