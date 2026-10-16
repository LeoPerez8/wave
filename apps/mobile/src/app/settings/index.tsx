import { SETTINGS_PAGES, type SettingsPage } from "@wave/core";
import { router } from "expo-router";
import { ScrollView, View } from "react-native";

import { grid } from "@/catalog/grid";
import { Hairline } from "@/catalog/Hairline";
import { ScreenHeader } from "@/components/ScreenHeader";
import { useRenderCount } from "@/perf/perf";
import { SettingsPageRow } from "@/settings/SettingsPage";
import { useSettingsSummaries } from "@/settings/settingsSummaries";

/** A row for each page, in Core's order; a handful, so a plain list. */
function SettingsPageRows({ summaries }: { summaries: Record<SettingsPage, string | null> }) {
  return SETTINGS_PAGES.map(({ page, title, route }) => (
    <SettingsPageRow
      key={page}
      title={title}
      summary={summaries[page]}
      onPress={() => router.push(route)}
    />
  ));
}

/** Settings: a row for each of its pages (Core's `SETTINGS_PAGES`), with a line on some. */
export default function SettingsScreen() {
  useRenderCount("SettingsScreen");
  const summaries = useSettingsSummaries();
  return (
    <View className="flex-1 bg-background">
      <ScreenHeader title="Settings" />
      <ScrollView contentContainerStyle={{ paddingHorizontal: grid.margin, paddingBottom: 48 }}>
        <Hairline />
        <SettingsPageRows summaries={summaries} />
      </ScrollView>
    </View>
  );
}
