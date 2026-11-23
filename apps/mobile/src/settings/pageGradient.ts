import { readPageGradient, storedPageGradient } from "@wave/core";

import { persistedSetting } from "@/lib/persistedSetting";

/**
 * Colour at the Top of Pages (Settings › Appearance), off unless the owner
 * turned it on: a subtle tint from the page's cover, or the playing song's,
 * fades into the ground at the top of every page (Core's `PAGE_TOP_FADE`).
 * Synced with the Wave account.
 */
const pageGradient = persistedSetting<boolean>({
  key: "settings.pageGradient",
  synced: true,
  read: readPageGradient,
  write: storedPageGradient,
});

export const setPageGradient = pageGradient.set;

/** Whether pages show the tint at their top; re-renders open pages when it changes. */
export const usePageGradient = pageGradient.useValue;
