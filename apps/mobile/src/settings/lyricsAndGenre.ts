import { persistedSetting } from "@/lib/persistedSetting";

/** Whether Wave may look songs' lyrics and genre up online (on unless the owner turned it off). */
const findLyricsAndGenre = persistedSetting<boolean>({
  key: "settings.findLyricsAndGenre",
  synced: true,
  read: (stored) => stored !== "off",
  write: (on) => (on ? null : "off"),
});

export const lyricsAndGenreLookupsEnabled = findLyricsAndGenre.get;

export const setLyricsAndGenreLookupsEnabled = findLyricsAndGenre.set;

/** Whether lyrics and genre lookups are allowed; re-renders when Settings changes it. */
export const useLyricsAndGenreLookupsEnabled = findLyricsAndGenre.useValue;
