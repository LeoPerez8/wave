import { timingStackListeners } from "@/lib/timing";
import type { LibrarySectionSlug } from "@wave/core";
import { Stack } from "expo-router";
import { View } from "react-native";

import { findSection } from "@/catalog/sections";
import { LargeTitle, useLargeTitleTop } from "@/components/LargeTitleScreen";
import { useThemeColor } from "@/theme/useThemeColor";

import { SectionList } from "./SectionList";
import { sectionTitleLongPress } from "./sectionTitleLongPress";

/**
 * A section tab's own stack (each section tab's `_layout`): what its list
 * opens (an artist, an album…) is pushed inside the tab, under the tab bar,
 * and stays open while you're on another tab.
 */
export function SectionTabStack() {
  const background = useThemeColor("background");
  return (
    <Stack
      screenListeners={timingStackListeners}
      screenOptions={{ headerShown: false, contentStyle: { backgroundColor: background } }}
    />
  );
}

/**
 * A section tab's first screen: the Library section [slug] as a tab of its
 * own. What it opens stays inside the tab (Core's `detailPath`), and the tab
 * keeps your place while you're on another one.
 */
export function SectionTabScreen({ slug }: { slug: LibrarySectionSlug }) {
  const top = useLargeTitleTop();
  const section = findSection(slug);
  return (
    <View className="flex-1 bg-background" style={{ paddingTop: top }}>
      <LargeTitle title={section?.label ?? slug} titleLongPress={sectionTitleLongPress(section)} />
      <SectionList section={section} />
    </View>
  );
}
