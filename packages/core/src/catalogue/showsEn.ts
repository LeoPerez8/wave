import { plural } from "../plural.ts";
import { formatNumber } from "../formatting.ts";

export const showsEn = {
  country: "Country",
  phoneRegion: "Phone's region",
  releases: "New music",
  level: "New music and shows",
  shelf: (country: string) => `Shows in ${country}`,
  notificationsOff: "Notifications are off",
  notificationSettings: "Open notification settings",
  channel: "Shows",
  tickets: "Tickets",
  /** Settings › Followed Artists' level icons and their legend. */
  newReleases: "New releases",
  newReleasesAndShowsIn: (country: string) => `New releases and shows in ${country}`,
  /** A level icon for TalkBack: what it does, then whose it is. */
  iconFor: (option: string, artist: string) => `${option}, ${artist}`,
  /** The toast after Unfollow on Settings › Followed Artists, and its action. */
  unfollowed: (artist: string) => `Unfollowed ${artist}`,
  undo: "Undo",
  /** Settings › Followed Artists' Suggested section, its button and why each artist is there. */
  suggested: "Suggested",
  showMore: "Show More",
  playsInLast90Days: (count: number) =>
    plural("en", count, {
      one: `${formatNumber("en", count)} play in the last 90 days`,
      other: `${formatNumber("en", count)} plays in the last 90 days`,
    }),
  allTimePlays: (count: number) =>
    plural("en", count, {
      one: `${formatNumber("en", count)} play`,
      other: `${formatNumber("en", count)} plays`,
    }),
};
