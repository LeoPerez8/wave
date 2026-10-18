import {
  cardFileName,
  lyricCardColours,
  lyricCardInk,
  type LyricShareApps,
  type LyricStoryBackground,
} from "./lyricsShare.ts";
import type { ArtworkPalette } from "./palette.ts";

/** Where a song's card can go from its share sheet. */
export type SongShareDestination = "instagramStories" | "whatsapp" | "more";

/**
 * The song share sheet's destinations, in order: the apps on hand first
 * (Instagram Stories, WhatsApp), as Spotify has them, then More, always.
 */
export const songShareDestinations = (apps: LyricShareApps): SongShareDestination[] => [
  ...(apps.instagramStories ? (["instagramStories"] as const) : []),
  ...(apps.whatsapp ? (["whatsapp"] as const) : []),
  "more",
];

/** The song card's PNG's file name: `Wave - <title> - <yyyyMMdd-HHmmss>.png`, local time. */
export const songCardFileName = (title: string | null, at: Date): string =>
  cardFileName(title, "Song", at);

/** A song card's colours: its own background and text, and the story's behind its sticker. */
export interface SongCardColours {
  readonly card: string;
  readonly ink: string;
  readonly story: LyricStoryBackground;
}

/**
 * The colours of a song's card, from its cover's [palette], as lowercase
 * `#rrggbb`: the story fades from the cover's dominant colour (top) down to
 * its dark muted one, else its dark vibrant one, else the next of its colours
 * (bottom), and the card takes that bottom colour, its text white or Wave's
 * ink for contrast (`lyricCardInk`). Wave's graphite without a palette.
 */
export const songCardColours = (palette: ArtworkPalette | null): SongCardColours => {
  const colours = lyricCardColours(palette);
  const top = colours[0] ?? "";
  const dark = [palette?.darkMuted, palette?.darkVibrant]
    .map((colour) => colour?.toLowerCase())
    .find((colour) => colour !== undefined && colour !== top && colours.includes(colour));
  const bottom = dark ?? colours[1] ?? top;
  return { card: bottom, ink: lyricCardInk(bottom), story: { top, bottom } };
};
