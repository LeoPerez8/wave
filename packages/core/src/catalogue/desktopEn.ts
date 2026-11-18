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
  itemActions: {
    labels: {
      // A song's link is copied rather than sent from a share sheet.
      share: "Copy Link",
    },
  },
  songDeletion: {
    // The file stays on the computer, excluded from the Library (Settings › Library includes it again).
    removeMessage: {
      one: "Its file stays on this computer. To bring it back, include it again in Settings › Library.",
      several:
        "Their files stay on this computer. To bring them back, include them again in Settings › Library.",
    },
  },
} satisfies CatalogueVariants;
