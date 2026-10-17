import { LAYOUT_PAGES } from "@wave/core";
import { router } from "expo-router";
import { View } from "react-native";

import { Hairline } from "@/catalog/Hairline";
import { SettingsPageRow, SettingsPageScreen } from "@/settings/SettingsPage";

/**
 * Settings › Layout: the options a long press opens on Home's, the
 * Library's and Playlists' titles and on the tab bar, a row each (Core's
 * `LAYOUT_PAGES`), for whoever doesn't know the long press.
 */
export default function LayoutSettingsScreen() {
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
    </SettingsPageScreen>
  );
}
