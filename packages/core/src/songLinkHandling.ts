/**
 * Whether Android lets Wave open the song links it declares (docs/spec.md,
 * "Opening a song link"): Wave doesn't own those domains, so from Android 12
 * a tapped link opens in Wave only for the hosts the owner turned on in
 * Android's Open by default page for Wave. Settings › Accounts' "Open song
 * links in Wave" row says which, from Android's domain verification user
 * state.
 */

import { catalogueOf, type AppLanguage } from "./localisation.ts";

/**
 * Android's domain verification user state for Wave: whether "Open supported
 * links" is on, and each web host Wave's intent filters declare with its state
 * (0 none, 1 selected by the owner, 2 verified).
 */
export type SongLinkHandlingState = {
  readonly allowed: boolean;
  readonly hosts: Readonly<Record<string, number>>;
};

/** Every declared host opens in Wave, some do, or none. */
export type SongLinkHandling = "all" | "some" | "none";

/** Selected and verified hosts open in Wave; with "Open supported links" off, none does. */
export const songLinkHandling = ({ allowed, hosts }: SongLinkHandlingState): SongLinkHandling => {
  const states = Object.values(hosts);
  const on = allowed ? states.filter((state) => state >= 1).length : 0;
  if (on === 0) return "none";
  return on === states.length ? "all" : "some";
};

/** The row's line under "Open song links in Wave". */
export const songLinkHandlingLine = (
  handling: SongLinkHandling,
  language: AppLanguage = "en",
): string => {
  const text = catalogueOf(language).settings;
  switch (handling) {
    case "all":
      return text.songLinksAll;
    case "some":
      return text.songLinksSome;
    case "none":
      return text.songLinksNone;
  }
};
