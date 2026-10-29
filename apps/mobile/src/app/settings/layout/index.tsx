import { useScreenContent } from "@/lib/screenTiming";
import { LAYOUT_PAGES } from "@wave/core";
import { router } from "@/lib/timingRouter";
import { Text, View } from "react-native";

import { Hairline } from "@/catalog/Hairline";
import { SettingsSwitch } from "@/components/SettingsSwitch";
import { setKeepFindVisible, useKeepFindVisible } from "@/settings/keepFindVisible";
import { SettingsPageRow, SettingsPageScreen } from "@/settings/SettingsPage";

/**
 * Settings › Layout: the options a long press opens on Home's, the
 * Library's and Playlists' titles and on the tab bar, and Now Playing's
 * buttons, a row each (Core's `LAYOUT_PAGES`), for whoever doesn't know the
 * long press; then Keep Find Field Visible.
 */
export default function LayoutSettingsScreen() {
  useScreenContent(true);
  const keepFindVisible = useKeepFindVisible();
  return (
    <SettingsPageScreen page="layout">
      <View>
        <Hairline />
        {LAYOUT_PAGES.map(({ page, title, route }) => (
          <SettingsPageRow
            key={page}
            title={title}
            summary={null}
            onPress={() => router.push(route)}
          />
        ))}
      </View>
      <View>
        <Hairline />
        <SettingsSwitch
          label="Keep Find Field Visible"
          value={keepFindVisible}
          onValueChange={setKeepFindVisible}
        />
        <Hairline />
        <Text className="mt-2 font-sans text-footnote text-secondary">
          The Find field stays under the page's header while the list scrolls, instead of waiting
          above the list until it's pulled down.
        </Text>
      </View>
    </SettingsPageScreen>
  );
}
