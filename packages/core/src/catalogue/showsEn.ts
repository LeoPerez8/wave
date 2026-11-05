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
};
