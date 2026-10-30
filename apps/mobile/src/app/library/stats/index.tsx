import { useLocalisation } from "@/localisation/localisation";
import { useScreenContent } from "@/lib/screenTiming";
import type { StatsPeriod } from "@wave/core";
import { useState } from "react";
import { ScrollView, View } from "react-native";

import { grid } from "@/catalog/grid";
import { TrackSkeletons } from "@/catalog/Skeletons";
import { TitledSection } from "@/catalog/TitledSection";
import { useChromeInset } from "@/chrome/chrome";
import { ScreenHeader } from "@/components/ScreenHeader";
import { openStatsSeeAll } from "@/library/routes";
import { useListScrollable } from "@/motion/heldTouch";
import { useRecaps, useTopAlbums, useTopArtists, useTopSongs, useTopGenres } from "@/stats/hooks";
import { GenrePodium } from "@/stats/GenrePodium";
import {
  NothingPlayed,
  PeriodTabs,
  RecapsRow,
  RankedAlbums,
  RankedArtists,
  RankedSongs,
  statsSongsContext,
} from "@/stats/StatsViews";

/** Stats: what was played most over a rolling period ending now. */
export default function StatsScreen() {
  const { strings } = useLocalisation();
  const [period, setPeriod] = useState<StatsPeriod>("month");
  const topSongs = useTopSongs(period);
  useScreenContent(topSongs !== undefined);
  const topAlbums = useTopAlbums(period);
  const topArtists = useTopArtists(period);
  const topGenres = useTopGenres(period);
  const recaps = useRecaps();
  const bottomInset = useChromeInset();
  const scrollable = useListScrollable();

  return (
    <View className="flex-1 bg-background">
      <ScreenHeader title={strings.home.sections.stats} />
      <ScrollView
        scrollEnabled={scrollable}
        contentContainerStyle={{ paddingHorizontal: grid.margin, paddingBottom: bottomInset }}
      >
        {recaps !== undefined && recaps.length > 0 && (
          <TitledSection title={strings.stats.recaps} first>
            <RecapsRow recaps={recaps} />
          </TitledSection>
        )}
        <PeriodTabs period={period} onChange={setPeriod} />
        {topSongs === undefined && <TrackSkeletons label={strings.stats.loadingListeningStats} />}
        {topSongs !== undefined && topSongs.length === 0 && <NothingPlayed period={period} />}
        {topSongs !== undefined && topSongs.length > 0 && (
          <TitledSection
            title={strings.stats.rankings.songs}
            action={{ label: strings.home.seeAll, onPress: () => openStatsSeeAll("songs", period) }}
          >
            <RankedSongs ranking={topSongs} context={statsSongsContext(period)} />
          </TitledSection>
        )}
        {topAlbums !== undefined && topAlbums.length > 0 && (
          <TitledSection
            title={strings.stats.rankings.albums}
            action={{
              label: strings.home.seeAll,
              onPress: () => openStatsSeeAll("albums", period),
            }}
          >
            <RankedAlbums ranking={topAlbums} />
          </TitledSection>
        )}
        {topArtists !== undefined && topArtists.length > 0 && (
          <TitledSection
            title={strings.stats.rankings.artists}
            action={{
              label: strings.home.seeAll,
              onPress: () => openStatsSeeAll("artists", period),
            }}
          >
            <RankedArtists ranking={topArtists} />
          </TitledSection>
        )}
        {topGenres !== undefined && topGenres.length > 0 && (
          <TitledSection title={strings.stats.genres}>
            <GenrePodium genres={topGenres} />
          </TitledSection>
        )}
      </ScrollView>
    </View>
  );
}
