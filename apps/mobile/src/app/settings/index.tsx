import { useScreenContent } from "@/lib/screenTiming";
import { createDeveloperTitleTaps, visibleSettingsPages, type SettingsPage } from "@wave/core";
import { useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { router } from "@/lib/timingRouter";
import { ScrollView, View } from "react-native";

import { grid } from "@/catalog/grid";
import { Hairline } from "@/catalog/Hairline";
import { ScreenHeader } from "@/components/ScreenHeader";
import { useRenderCount } from "@/perf/perf";
import { showToast } from "@/overlay/toast";
import {
  developerSettingsVisible,
  setDeveloperSettingsVisible,
  useDeveloperSettingsVisible,
} from "@/settings/developer";
import { SettingsPageRow } from "@/settings/SettingsPage";
import { useSettingsSummaries } from "@/settings/settingsSummaries";

/** A row for each page, in Core's order; a handful, so a plain list. */
function SettingsPageRows({
  summaries,
  developerVisible,
}: {
  summaries: Record<SettingsPage, string | null>;
  developerVisible: boolean;
}) {
  return visibleSettingsPages(developerVisible).map(({ page, title, route, icon, colour }) => (
    <SettingsPageRow
      key={page}
      title={title}
      summary={summaries[page]}
      tile={{ icon, colour }}
      onPress={() => router.push(route)}
    />
  ));
}

/** Settings: a row for each of its pages (Core's `SETTINGS_PAGES`), with a line on some. */
export default function SettingsScreen() {
  useScreenContent(true);
  useRenderCount("SettingsScreen");
  const summaries = useSettingsSummaries();
  const developerVisible = useDeveloperSettingsVisible();
  const [titleTaps] = useState(createDeveloperTitleTaps);
  useFocusEffect(useCallback(() => () => titleTaps.reset(), [titleTaps]));

  const onTitlePress = (): void => {
    const visible = titleTaps.tap(developerSettingsVisible(), performance.now());
    if (visible === null) return;
    setDeveloperSettingsVisible(visible);
    void showToast(visible ? "Developer is on" : "Developer hidden");
  };

  return (
    <View className="flex-1 bg-background">
      <ScreenHeader title="Settings" onTitlePress={onTitlePress} />
      <ScrollView contentContainerStyle={{ paddingHorizontal: grid.margin, paddingBottom: 48 }}>
        <Hairline />
        <SettingsPageRows summaries={summaries} developerVisible={developerVisible} />
      </ScrollView>
    </View>
  );
}
