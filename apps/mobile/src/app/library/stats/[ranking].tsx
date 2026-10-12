import { IconChartBar } from "@tabler/icons-react-native";
import {
  STATS_PERIODS,
  STATS_RANKINGS,
  statsSeeAll,
  type StatsPeriod,
  type StatsSeeAll,
} from "@wave/core";
import { useLocalSearchParams } from "expo-router";
import { View } from "react-native";

import { CatalogLine } from "@/catalog/CatalogLine";
import { CELL, grid } from "@/catalog/grid";
import { EmptyState } from "@/components/EmptyState";
import { ScreenHeader } from "@/components/ScreenHeader";
import { useAllTopSongs } from "@/stats/hooks";
import { nothingPlayed, RankedSongList } from "@/stats/StatsViews";

/** The list's opening: the period it covers. */
function PeriodLine({ period }: { period: StatsPeriod }) {
  const label = STATS_PERIODS.find((option) => option.id === period)?.label ?? "";
  return (
    <View style={{ paddingBottom: CELL }}>
      <CatalogLine>{label}</CatalogLine>
    </View>
  );
}

function NothingPlayed({ period }: { period: StatsPeriod }) {
  return (
    <View style={{ paddingHorizontal: grid.margin }}>
      <EmptyState
        icon={IconChartBar}
        title={nothingPlayed(period)}
        message="Songs you listen to for half their length, or four minutes, are counted here."
      />
    </View>
  );
}

function AllTopSongs({ period }: { period: StatsPeriod }) {
  const ranking = useAllTopSongs(period);
  if (ranking === undefined) return null;
  if (ranking.length === 0) return <NothingPlayed period={period} />;
  return (
    <RankedSongList ranking={ranking} period={period} header={<PeriodLine period={period} />} />
  );
}

/** One ranking's full list; a ranking without one yet shows the "gone" state. */
function SeeAllList({ seeAll }: { seeAll: StatsSeeAll | undefined }) {
  switch (seeAll?.ranking) {
    case "songs":
      return <AllTopSongs period={seeAll.period} />;
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
