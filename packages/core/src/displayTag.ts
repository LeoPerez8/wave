import { UNKNOWN_ALBUM, UNKNOWN_ARTIST } from "./library.ts";
import { catalogueOf, type AppLanguage } from "./localisation.ts";

/** Translate stored stand-ins only when shown. Library identity and tags stay as stored. */
export const displayTag = (
  value: string,
  kind: "album" | "artist",
  language: AppLanguage,
): string => {
  const strings = catalogueOf(language).playbackText;
  if (kind === "album" && value === UNKNOWN_ALBUM) return strings.unknownAlbum;
  if (kind === "artist" && value === UNKNOWN_ARTIST) return strings.unknownArtist;
  return value;
};
