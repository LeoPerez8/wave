import type { Catalogue } from "@wave/core";

import { openStats } from "@/library/routes";

/** Loaded Stats and its placeholder offer the same navigation. */
export const statsSeeAllAction = (strings: Catalogue) => ({
  label: strings.home.seeAll,
  onPress: openStats,
});
