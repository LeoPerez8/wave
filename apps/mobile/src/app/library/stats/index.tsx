import type { StatsPeriod } from "@wave/core";
import { useState } from "react";
import { ScrollView, View } from "react-native";

import { grid } from "@/catalog/grid";
import { useChromeInset } from "@/chrome/chrome";
import { ScreenHeader } from "@/components/ScreenHeader";
import { HomeSection } from "@/home/HomeSections";
import { openStatsSeeAll } from "@/library/routes";
import { useTopAlbums, useTopArtists, useTopSongs } from "@/stats/hooks";
import {
  NothingPlayed,
  PeriodTabs,
  RankedAlbums,
  RankedArtists,
  RankedSongs,
} from "@/stats/StatsViews";

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
        {topSongs !== undefined && topSongs.length === 0 && <NothingPlayed period={period} />}
        {topSongs !== undefined && topSongs.length > 0 && (
          <HomeSection
            title="Top songs"
            action={{ label: "See all", onPress: () => openStatsSeeAll("songs", period) }}
          >
            <RankedSongs ranking={topSongs} period={period} />
          </HomeSection>
        )}
        {topAlbums !== undefined && topAlbums.length > 0 && (
          <HomeSection
            title="Top albums"
            action={{ label: "See all", onPress: () => openStatsSeeAll("albums", period) }}
          >
            <RankedAlbums ranking={topAlbums} />
          </HomeSection>
        )}
        {topArtists !== undefined && topArtists.length > 0 && (
          <HomeSection
            title="Top artists"
            action={{ label: "See all", onPress: () => openStatsSeeAll("artists", period) }}
          >
            <RankedArtists ranking={topArtists} />
          </HomeSection>
        )}
      </ScrollView>
    </View>
  );
}
