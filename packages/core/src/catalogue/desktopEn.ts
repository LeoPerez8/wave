import type { CatalogueVariants } from "../localisation.ts";

/**
 * The desktop's wording where the phone's text names the phone
 * (docs/spec-desktop.md, Language). Only the phrases that differ go here;
 * `desktopPtBr.ts` holds the same keys.
 */
export const desktopEn = {
  playbackText: {
    thisPhone: "This computer",
  },
  settings: {
    howMuchOfAStreamedSongWave:
      "How much of a streamed song Wave loads ahead, carrying on into the next songs in Up Next, so playback keeps going through a dead zone. Longer uses more memory: about 50 MB at 30 minutes. Downloaded songs play from this computer either way.",
  },
} satisfies CatalogueVariants;
