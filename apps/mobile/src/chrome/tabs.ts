import { IconHome, IconSearch, IconStack2, type Icon } from "@tabler/icons-react-native";
import type { TabBarTab } from "@wave/core";

import { findSection } from "@/catalog/sections";

/** How a tab shows in the bar and in its editor. */
export interface TabLook {
  readonly label: string;
  readonly icon: Icon;
}

const FIXED: Readonly<Record<"index" | "library" | "search", TabLook>> = {
  index: { label: "Home", icon: IconHome },
  library: { label: "Library", icon: IconStack2 },
  search: { label: "Search", icon: IconSearch },
};

/** [tab]'s label and icon: a section tab takes its Library section's. */
export const tabLook = (tab: TabBarTab): TabLook => {
  if (tab === "index" || tab === "library" || tab === "search") return FIXED[tab];
  const section = findSection(tab);
  return { label: section?.label ?? tab, icon: section?.icon ?? IconStack2 };
};
