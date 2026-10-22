import { useScreenContent } from "@/lib/screenTiming";
import { TabBarEditor } from "@/chrome/TabBarEditor";
import { editSavedTabBar, useTabBar } from "@/settings/tabBar";
import { SettingsEditorScreen } from "@/settings/SettingsPage";

/**
 * Settings › Layout › Tab bar: the bar's editor as a page, the one a long
 * press on the bar opens. Each change is saved as it's made, so the bar shows
 * it at once.
 */
export default function TabBarLayoutSettingsScreen() {
  useScreenContent(true);
  return (
    <SettingsEditorScreen layoutPage="tabBar">
      <TabBarEditor bar={useTabBar()} edit={editSavedTabBar} />
    </SettingsEditorScreen>
  );
}
