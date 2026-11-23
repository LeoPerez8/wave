/**
 * The page-top gradient (Settings › Appearance, docs/spec.md "Visual
 * design"): off by default; on, the top of every page takes a short, very
 * subtle fade from a cover's colours into the theme's ground
 * (`PAGE_TOP_FADE`, drawn by `groundGradient`).
 */

import type { ArtworkPalette } from "./palette.ts";

/** Whether the switch is on, from what the key-value store holds (null: nothing, off). */
export const readPageGradient = (stored: string | null): boolean => stored === "on";

/** What to store for the switch: nothing when off, so it reads back (and syncs) as the default. */
export const storedPageGradient = (on: boolean): string | null => (on ? "on" : null);

/**
 * A page's own cover, as far as its colours go: null for a page without one
 * (Home, Search, Settings…), "loading" while an album, playlist or artist
 * page reads its cover's colours, then those colours (null when none are
 * known, as for a playlist's own photo).
 */
export type PageCover = null | "loading" | { readonly palette: ArtworkPalette | null };

/**
 * The colours a page's top fades from: its own cover's, else the playing
 * song's (null, no colour, when nothing plays). While its cover's colours
 * load it shows none, so the playing song's never flash before them.
 */
export const pageGradientPalette = (
  cover: PageCover,
  playing: ArtworkPalette | null,
): ArtworkPalette | null => {
  if (cover === "loading") return null;
  return cover?.palette ?? playing;
};
