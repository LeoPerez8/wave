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
} satisfies CatalogueVariants;
