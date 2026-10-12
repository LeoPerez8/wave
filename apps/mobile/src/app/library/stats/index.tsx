import { IconChartBar } from "@tabler/icons-react-native";
import type { StatsPeriod } from "@wave/core";
import { useState } from "react";
import { ScrollView, View } from "react-native";

import { grid } from "@/catalog/grid";
import { useChromeInset } from "@/chrome/chrome";
import { EmptyState } from "@/components/EmptyState";
import { ScreenHeader } from "@/components/ScreenHeader";
import { HomeSection } from "@/home/HomeSections";
import { openStatsSeeAll } from "@/library/routes";
import { useTopSongs } from "@/stats/hooks";
import { nothingPlayed, PeriodTabs, RankedSongs } from "@/stats/StatsViews";

/** Stats: what was played most over a rolling period ending now. */
export default function StatsScreen() {
  const [period, setPeriod] = useState<StatsPeriod>("month");
  const topSongs = useTopSongs(period);
  const bottomInset = useChromeInset();

  return (
    <View className="flex-1 bg-background">
      <ScreenHeader title="Stats" />
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: grid.margin, paddingBottom: bottomInset }}
      >
        <PeriodTabs period={period} onChange={setPeriod} />
        {topSongs !== undefined && topSongs.length === 0 && (
          <EmptyState
            icon={IconChartBar}
            title={nothingPlayed(period)}
            message="Songs you listen to for half their length, or four minutes, are counted here."
          />
        )}
        {topSongs !== undefined && topSongs.length > 0 && (
          <HomeSection
            title="Top songs"
            action={{ label: "See all", onPress: () => openStatsSeeAll("songs", period) }}
          >
            <RankedSongs ranking={topSongs} period={period} />
          </HomeSection>
        )}
      </ScrollView>
    </View>
  );
}
