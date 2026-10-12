import { Redirect } from "expo-router";
import { Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { grid } from "@/catalog/grid";
import { findSection } from "@/catalog/sections";
import { SectionList } from "@/library/SectionList";
import { useShortcutTab } from "@/settings/shortcutTab";

/**
 * The shortcut tab: the Library section chosen in Settings, as a tab of its
 * own. Its list stays mounted while you're on another tab, so you come back
 * to where you were; what it opens (an artist, an album…) is pushed over the
 * tabs, as from the Library, and Back lands here.
 */
export default function ShortcutScreen() {
  const insets = useSafeAreaInsets();
  const slug = useShortcutTab();
  const section = slug === null ? undefined : findSection(slug);
  // Only reachable through its tab, which None removes.
  if (section === undefined) return <Redirect href="/library" />;
  return (
    <View className="flex-1 bg-background">
      <View
        style={{ paddingTop: insets.top + 16, paddingHorizontal: grid.margin, paddingBottom: 16 }}
      >
        <Text
          accessibilityRole="header"
          className="font-sans text-large-title font-light text-foreground"
          style={{ letterSpacing: -0.6 }}
        >
          {section.label}
        </Text>
      </View>
      <SectionList key={section.slug} section={section} />
    </View>
  );
}
