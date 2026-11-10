/**
 * The short messages a link shared or tapped into Wave shows instead of
 * opening something (docs/spec.md, "Sharing to Wave" and "Opening a song
 * link"), shared by playlist links (`playlistLinks.ts`) and song links
 * (`songLinkOpening.ts`).
 */

import { catalogueOf, type AppLanguage } from "./localisation.ts";

/** A short message shown instead of the import card or the song. */
export interface ImportNotice {
  readonly title: string;
  readonly message: string;
}

/** Why a link isn't read with YT Music off, wherever it came from, in [language]. */
export const ytMusicOffNotice = (language: AppLanguage = "en"): ImportNotice => {
  const text = catalogueOf(language).imports;
  return { title: text.ytMusicOff, message: text.ytMusicOffMessage };
};

/** Why a link isn't read with YT Music off, in English. */
export const YT_MUSIC_OFF_NOTICE: ImportNotice = ytMusicOffNotice();

/** "Can't open this", saying which links Wave opens, in [language]. */
export const cantOpenNotice = (language: AppLanguage = "en"): ImportNotice => {
  const text = catalogueOf(language).imports;
  return { title: text.cantOpen, message: text.sharedLinks };
};
