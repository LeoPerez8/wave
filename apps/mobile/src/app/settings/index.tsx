import { useRenderCost } from "@/lib/renderCost";
import { useScreenContent } from "@/lib/screenTiming";
import { useLocalisation } from "@/localisation/localisation";
import {
  createDeveloperTitleTaps,
  visibleSettingsPages,
  type SettingsIcon,
  type SettingsPage,
} from "@wave/core";
import { useFocusEffect } from "expo-router";
import { memo, useCallback, useState } from "react";
import { router } from "@/lib/timingRouter";
import { View } from "react-native";
import Animated from "react-native-reanimated";

import { grid } from "@/catalog/grid";
import { Hairline } from "@/catalog/Hairline";
import { ScreenHeader } from "@/components/ScreenHeader";
import { StagedSections } from "@/components/StagedSections";
import { useRenderCount } from "@/perf/perf";
import { showToast } from "@/overlay/toast";
import {
  developerSettingsVisible,
  setDeveloperSettingsVisible,
  useDeveloperSettingsVisible,
} from "@/settings/developer";
import { SettingsPageRow } from "@/settings/SettingsPage";
import { useSettingsSummaries } from "@/settings/settingsSummaries";
import { InstallNowButton } from "@/updates/InstallNowButton";
import { UpdateCheckRefreshControl } from "@/updates/UpdateCheckRefreshControl";
import { PageTopGradient } from "@/pageGradient/PageGradient";
import { useListScroll } from "@/lib/useListScroll";

/**
 * One page's row, from primitives so a summary that changes redraws only its
 * own row (#1355). Version History's carries Install Now on its right edge
 * while an update is ready.
 */
const SettingsIndexRow = memo(function SettingsIndexRow({
  page,
  title,
  summary,
  icon,
  route,
}: {
  page: SettingsPage;
  title: string;
  summary: string | null;
  icon: SettingsIcon;
  route: `/settings/${string}`;
}) {
  return (
    <SettingsPageRow
      title={title}
      summary={summary}
      icon={icon}
      trailing={page === "versionHistory" ? <InstallNowButton /> : undefined}
      onPress={() => router.push(route)}
    />
  );
});

/**
 * A row for each page, in Core's order; a handful, so a plain list, mounted
 * across frames from the top so the first frame holds only the rows on screen.
 */
function SettingsPageRows({
  summaries,
  developerVisible,
}: {
  summaries: Record<SettingsPage, string | null>;
  developerVisible: boolean;
}) {
  const { strings } = useLocalisation();
  return (
    <StagedSections estimate={grid.row}>
      {visibleSettingsPages(developerVisible, strings).map(({ page, title, route, icon }) => (
        <SettingsIndexRow
          key={page}
          page={page}
          title={title}
          summary={summaries[page]}
          icon={icon}
          route={route}
        />
      ))}
    </StagedSections>
  );
}

/**
 * Settings: a row for each of its pages (Core's `SETTINGS_PAGES`), with a line on some. A pull
 * checks for updates now and reads the version history again.
 */
export default function SettingsScreen() {
  const { strings } = useLocalisation();
  useScreenContent(true);
  useRenderCount("SettingsScreen");
  useRenderCost("SettingsScreen");
  const summaries = useSettingsSummaries();
  const developerVisible = useDeveloperSettingsVisible();
  const [titleTaps] = useState(createDeveloperTitleTaps);
  // Its scroll moves the page-top gradient.
  const { scrollRef } = useListScroll(0);
  useFocusEffect(useCallback(() => () => titleTaps.reset(), [titleTaps]));

  const onTitlePress = (): void => {
    const visible = titleTaps.tap(developerSettingsVisible(), performance.now());
    if (visible === null) return;
    setDeveloperSettingsVisible(visible);
    void showToast(visible ? strings.settings.developerIsOn : strings.settings.developerHidden);
  };

  return (
    <View className="flex-1 bg-background">
      <PageTopGradient />
      <ScreenHeader title={strings.settings.settings} onTitlePress={onTitlePress} />
      <Animated.ScrollView
        ref={scrollRef}
        scrollEventThrottle={16}
        refreshControl={<UpdateCheckRefreshControl />}
        contentContainerStyle={{ paddingHorizontal: grid.margin, paddingBottom: 48 }}
      >
        <Hairline />
        <SettingsPageRows summaries={summaries} developerVisible={developerVisible} />
      </Animated.ScrollView>
    </View>
  );
}
