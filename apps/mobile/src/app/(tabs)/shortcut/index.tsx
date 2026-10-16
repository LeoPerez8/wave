import { Redirect } from "expo-router";
import { View } from "react-native";

import { findSection } from "@/catalog/sections";
import { LargeTitle, useLargeTitleTop } from "@/components/LargeTitleScreen";
import { SectionList } from "@/library/SectionList";
import { sectionTitleLongPress } from "@/library/sectionTitleLongPress";
import { useShortcutTab } from "@/settings/shortcutTab";

/**
 * The shortcut tab: the Library section chosen in Settings, as a tab of its
 * own. What it opens (an artist, an album…) stays inside the tab, and the
 * tab keeps your place while you're on another one.
 */
export default function ShortcutScreen() {
  const top = useLargeTitleTop();
  const slug = useShortcutTab();
  const section = slug === null ? undefined : findSection(slug);
  // Only reachable through its tab, which None removes.
  if (section === undefined) return <Redirect href="/library" />;
  return (
    <View className="flex-1 bg-background" style={{ paddingTop: top }}>
      <LargeTitle title={section.label} titleLongPress={sectionTitleLongPress(section)} />
      <SectionList key={section.slug} section={section} />
    </View>
  );
}
