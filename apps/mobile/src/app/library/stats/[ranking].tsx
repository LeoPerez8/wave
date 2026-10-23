import { useScreenContent } from "@/lib/screenTiming";
import { IconChartBar } from "@tabler/icons-react-native";
import {
  STATS_RANKINGS,
  STATS_SEE_ALL,
  statsSeeAll,
  type StatsPeriod,
  type StatsSeeAll,
} from "@wave/core";
import { useLocalSearchParams } from "expo-router";
import { View } from "react-native";

import { CatalogLine } from "@/catalog/CatalogLine";
import { CELL, grid } from "@/catalog/grid";
import { TrackSkeletons } from "@/catalog/Skeletons";
import { EmptyState } from "@/components/EmptyState";
import { ScreenHeader } from "@/components/ScreenHeader";
import { useTopAlbums, useTopArtists, useTopSongs } from "@/stats/hooks";
import {
  NothingPlayed,
  periodLabel,
  RankedAlbumList,
  RankedArtistList,
  RankedSongList,
} from "@/stats/StatsViews";

/** The list's opening: the period it covers. */
function PeriodLine({ period }: { period: StatsPeriod }) {
  return (
    <View style={{ paddingBottom: CELL }}>
      <CatalogLine>{periodLabel(period)}</CatalogLine>
    </View>
  );
}

function NothingPlayedHere({ period }: { period: StatsPeriod }) {
  return (
    <View style={{ paddingHorizontal: grid.margin }}>
      <NothingPlayed period={period} />
    </View>
  );
}

function LoadingRanking() {
  return (
    <View style={{ paddingHorizontal: grid.margin }}>
      <TrackSkeletons label="Loading ranking" />
    </View>
  );
}

function AllTopSongs({ period }: { period: StatsPeriod }) {
  const ranking = useTopSongs(period, STATS_SEE_ALL);
  useScreenContent(ranking !== undefined);
  if (ranking === undefined) return <LoadingRanking />;
  if (ranking.length === 0) return <NothingPlayedHere period={period} />;
  return (
    <RankedSongList ranking={ranking} period={period} header={<PeriodLine period={period} />} />
  );
}

function AllTopAlbums({ period }: { period: StatsPeriod }) {
  const ranking = useTopAlbums(period, STATS_SEE_ALL);
  useScreenContent(ranking !== undefined);
  if (ranking === undefined) return <LoadingRanking />;
  if (ranking.length === 0) return <NothingPlayedHere period={period} />;
  return <RankedAlbumList ranking={ranking} header={<PeriodLine period={period} />} />;
}

function AllTopArtists({ period }: { period: StatsPeriod }) {
  const ranking = useTopArtists(period, STATS_SEE_ALL);
  useScreenContent(ranking !== undefined);
  if (ranking === undefined) return <LoadingRanking />;
  if (ranking.length === 0) return <NothingPlayedHere period={period} />;
  return <RankedArtistList ranking={ranking} header={<PeriodLine period={period} />} />;
}

/** One ranking's full list; a ranking without one yet shows the "gone" state. */
function SeeAllList({ seeAll }: { seeAll: StatsSeeAll | undefined }) {
  switch (seeAll?.ranking) {
    case "songs":
      return <AllTopSongs period={seeAll.period} />;
    case "albums":
      return <AllTopAlbums period={seeAll.period} />;
    case "artists":
      return <AllTopArtists period={seeAll.period} />;
    default:
      return (
        <View style={{ paddingHorizontal: grid.margin }}>
          <EmptyState
            icon={IconChartBar}
            title="Nothing here"
            message="This ranking doesn't exist."
          />
        </View>
      );
  }
}

/** Stats › See all: up to 100 entries of one ranking, for the period selected on Stats. */
export default function StatsSeeAllScreen() {
  const params = useLocalSearchParams<{ ranking: string; period: string }>();
  const seeAll = statsSeeAll(params.ranking, params.period);
  const title = STATS_RANKINGS.find((ranking) => ranking.id === seeAll?.ranking)?.title;
  return (
    <View className="flex-1 bg-background">
      <ScreenHeader title={title ?? "Stats"} />
      <SeeAllList seeAll={seeAll} />
    </View>
  );
}
