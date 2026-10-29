import { IconHome, IconSearch, IconStack2, type Icon } from "@tabler/icons-react-native";
import type { Catalogue, TabBarTab } from "@wave/core";

import { findSection } from "@/catalog/sections";

/** How a tab shows in the bar and in its editor. */
export interface TabLook {
  readonly label: string;
  readonly icon: Icon;
}

const FIXED_ICONS: Readonly<Record<"index" | "library" | "search", Icon>> = {
  index: IconHome,
  library: IconStack2,
  search: IconSearch,
};

/** [tab]'s label in [strings]' language, and its icon: a section tab takes its Library section's. */
export const tabLook = (tab: TabBarTab, strings: Catalogue): TabLook => ({
  label: strings.tabs[tab],
  icon:
    tab === "index" || tab === "library" || tab === "search"
      ? FIXED_ICONS[tab]
      : (findSection(tab)?.icon ?? IconStack2),
});
