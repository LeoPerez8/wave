import { IconChartBar } from "@tabler/icons-react-native";
import { STATS_PERIODS, type StatsPeriod } from "@wave/core";
import { useState } from "react";
import { ScrollView, View } from "react-native";

import { grid } from "@/catalog/grid";
import { useChromeInset } from "@/chrome/chrome";
import { EmptyState } from "@/components/EmptyState";
import { ScreenHeader } from "@/components/ScreenHeader";
import { HomeSection } from "@/home/HomeSections";
import { useTopAlbums, useTopArtists, useTopSongs } from "@/stats/hooks";
import { PeriodTabs, RankedAlbums, RankedArtists, RankedSongs } from "@/stats/StatsViews";

/** "No plays in the last 7 days", or "No plays yet" for all time. */
const nothingPlayed = (period: StatsPeriod): string => {
  const label = STATS_PERIODS.find((option) => option.id === period)?.label;
  return period === "all" || label === undefined
    ? "No plays yet"
    : `No plays in the ${label.toLowerCase()}`;
};

/** Stats: what was played most over a rolling period ending now. */
export default function StatsScreen() {
  const [period, setPeriod] = useState<StatsPeriod>("month");
  const topSongs = useTopSongs(period);
  const topAlbums = useTopAlbums(period);
  const topArtists = useTopArtists(period);
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
          <HomeSection title="Top songs">
            <RankedSongs ranking={topSongs} period={period} />
          </HomeSection>
        )}
        {topAlbums !== undefined && topAlbums.length > 0 && (
          <HomeSection title="Top albums">
            <RankedAlbums ranking={topAlbums} />
          </HomeSection>
        )}
        {topArtists !== undefined && topArtists.length > 0 && (
          <HomeSection title="Top artists">
            <RankedArtists ranking={topArtists} />
          </HomeSection>
        )}
      </ScrollView>
    </View>
  );
}
