import { useScreenContent } from "@/lib/screenTiming";
import { useLocalisation } from "@/localisation/localisation";
import { createDeveloperTitleTaps, visibleSettingsPages, type SettingsPage } from "@wave/core";
import { useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { router } from "@/lib/timingRouter";
import { ScrollView, Text, View } from "react-native";

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
import { RUNNING_VERSION } from "@/updates/runningVersion";

/** A row for each page, in Core's order; a handful, so a plain list. */
function SettingsPageRows({
  summaries,
  developerVisible,
}: {
  summaries: Record<SettingsPage, string | null>;
  developerVisible: boolean;
}) {
  const { strings } = useLocalisation();
  return visibleSettingsPages(developerVisible, strings).map(({ page, title, route, icon }) => (
    <SettingsPageRow
      key={page}
      title={title}
      summary={summaries[page]}
      icon={icon}
      onPress={() => router.push(route)}
    />
  ));
}

/** Settings: a row for each of its pages (Core's `SETTINGS_PAGES`), with a line on some. */
export default function SettingsScreen() {
  const { strings } = useLocalisation();
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
    void showToast(visible ? strings.settings.developerIsOn : strings.settings.developerHidden);
  };

  return (
    <View className="flex-1 bg-background">
      <ScreenHeader title={strings.settings.settings} onTitlePress={onTitlePress} />
      <ScrollView contentContainerStyle={{ paddingHorizontal: grid.margin, paddingBottom: 48 }}>
        <Hairline />
        <SettingsPageRows summaries={summaries} developerVisible={developerVisible} />
        {RUNNING_VERSION !== null && (
          <Text className="pt-6 text-center font-sans text-footnote text-secondary" selectable>
            {strings.whatsNew.version(RUNNING_VERSION)}
          </Text>
        )}
      </ScrollView>
    </View>
  );
}
