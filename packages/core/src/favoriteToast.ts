import { catalogueOf, type AppLanguage } from "./localisation.ts";

/**
 * Where a song's star was changed. Now Playing's star and cover, Recognize's star and the
 * match notification's button confirm it themselves.
 */
export type FavoriteSource =
  "swipe" | "menu" | "selection" | "nowPlaying" | "recognize" | "notification";

const SILENT: ReadonlySet<FavoriteSource> = new Set(["nowPlaying", "recognize", "notification"]);

/**
 * The confirmation for starring [count] songs in [language], or none where the
 * star already confirms it.
 */
export const favoriteToast = (
  source: FavoriteSource,
  on: boolean,
  count: number,
  language: AppLanguage = "en",
): string | null => {
  if (SILENT.has(source) || !on || count < 1) return null;
  const text = catalogueOf(language).itemActions;
  return count === 1 ? text.addedToFavorites : text.addedSongsToFavorites(count);
};
