/**
 * Settings › Find Lyrics and Genre: whether Wave may look songs' lyrics and genre up online. On
 * unless the owner turned it off, so nothing stored reads as on. The account syncs it, so the
 * phone and the computer keep it under one key.
 */
export const FIND_LYRICS_AND_GENRE_SETTING = "settings.findLyricsAndGenre";

export const readFindLyricsAndGenre = (stored: string | null | undefined): boolean =>
  stored !== "off";

/** What the key-value store keeps for the switch: null at its default, on. */
export const writeFindLyricsAndGenre = (on: boolean): string | null => (on ? null : "off");
