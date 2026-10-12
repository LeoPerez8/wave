import { Stack } from "expo-router";

import { useThemeColor } from "@/theme/useThemeColor";

// The tab trigger's /shortcut is this stack's first screen, so switching back
// to the tab returns to whatever is open in it rather than to the list.
export const unstable_settings = { initialRouteName: "index" };

/**
 * The shortcut tab's own stack: what its list opens (an artist, an album…)
 * is pushed inside the tab, under the tab bar, and stays open while you're
 * on another tab.
 */
export default function ShortcutLayout() {
  const background = useThemeColor("background");
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: background } }} />
  );
}
