import { LegendList } from "@legendapp/list/react-native";
import { STATS_PERIODS, type StatsPeriod } from "@wave/core";
import { useCallback, useMemo, type ReactElement } from "react";
import { Text, View } from "react-native";

import { CELL, grid } from "@/catalog/grid";
import { TrackRow } from "@/catalog/TrackRow";
import { useChromeInset } from "@/chrome/chrome";
import { useFavoriteIds } from "@/library/favorites";
import type { SongRow } from "@/library/LibraryStore";
import { toTrackSummary } from "@/library/TrackList";
import { Press } from "@/motion/Press";
import { playSongs } from "@/playback/actions";
import { useCurrentTrackId } from "@/playback/hooks";
import { openTrackActions } from "@/playback/TrackActionsSheet";

import type { Ranked } from "./Stats";

/** "3 plays", "1 play". */
export const playCount = (count: number): string =>
  `${count.toLocaleString("en")} ${count === 1 ? "play" : "plays"}`;

/** The period selector: text tabs, the selected one in ink with a teal underline. */
export function PeriodTabs({
  period,
  onChange,
}: {
  period: StatsPeriod;
  onChange: (period: StatsPeriod) => void;
}) {
  return (
    // Wraps rather than clips at large font scales.
    <View
      accessibilityRole="tablist"
      className="flex-row flex-wrap"
      style={{ columnGap: CELL * 3 }}
    >
      {STATS_PERIODS.map((option) => {
        const selected = option.id === period;
        return (
          <Press
            key={option.id}
            accessibilityRole="tab"
            accessibilityLabel={option.label}
            accessibilityState={{ selected }}
            onPress={() => onChange(option.id)}
            haptic="selection"
            style={{ minHeight: 48, justifyContent: "center" }}
          >
            <Text
              numberOfLines={1}
              className={`font-sans text-body ${
                selected ? "font-semibold text-foreground" : "text-secondary"
              }`}
            >
              {option.tab}
            </Text>
            <View
              className={selected ? "bg-accent" : "bg-transparent"}
              style={{ height: 2, marginTop: CELL / 2 }}
            />
          </Press>
        );
      })}
    </View>
  );
}

/** A ranked song: numbered by rank (the top one in ember), its counted plays beside the artist. */
function RankedSongRow({
  entry: { item: song, countedPlays },
  index,
  songs,
  period,
  currentId,
  favorites,
}: {
  entry: Ranked<SongRow>;
  index: number;
  /** The whole ranking's songs: tapping a row plays them from it. */
  songs: readonly SongRow[];
  period: StatsPeriod;
  currentId: string | null;
  favorites: ReadonlySet<number>;
}) {
  return (
    <TrackRow
      track={{
        ...toTrackSummary(song),
        artist: `${song.artist} · ${playCount(countedPlays)}`,
        trackNumber: index + 1,
      }}
      state={String(song.id) === currentId ? "playing" : undefined}
      favorite={favorites.has(song.id)}
      leading="number"
      topNumber={index === 0}
      onPress={() => playSongs(songs, index, { kind: "stats", id: `songs-${period}` })}
      onLongPress={() => openTrackActions(song)}
    />
  );
}

/**
 * A song ranking: each row numbered by rank (the top one in ember), with its
 * counted plays beside the artist. Tapping a song plays the ranking from it;
 * long-press opens the song's menu.
 */
export function RankedSongs({
  ranking,
  period,
}: {
  ranking: readonly Ranked<SongRow>[];
  period: StatsPeriod;
}) {
  const currentId = useCurrentTrackId();
  const favorites = useFavoriteIds();
  const songs = ranking.map((entry) => entry.item);
  return (
    <View>
      {ranking.map((entry, index) => (
        <RankedSongRow
          key={entry.item.id}
          entry={entry}
          index={index}
          songs={songs}
          period={period}
          currentId={currentId}
          favorites={favorites}
        />
      ))}
    </View>
  );
}

/** A See all list's key: the ranked entity's id. */
export const rankedKey = (entry: Ranked<{ readonly id: number }>): string => String(entry.item.id);

/**
 * See all › Top songs: the Stats screen's rows, virtualised. Tap and
 * long-press behave as on the Stats screen.
 */
export function RankedSongList({
  ranking,
  period,
  header,
}: {
  ranking: readonly Ranked<SongRow>[];
  period: StatsPeriod;
  header?: ReactElement;
}) {
  const bottomInset = useChromeInset();
  const currentId = useCurrentTrackId();
  const favorites = useFavoriteIds();
  const rowState = useMemo(() => ({ currentId, favorites }), [currentId, favorites]);
  const songs = useMemo(() => ranking.map((entry) => entry.item), [ranking]);
  const renderItem = useCallback(
    ({ item, index }: { item: Ranked<SongRow>; index: number }) => (
      <RankedSongRow
        entry={item}
        index={index}
        songs={songs}
        period={period}
        currentId={currentId}
        favorites={favorites}
      />
    ),
    [songs, period, currentId, favorites],
  );
  return (
    <LegendList
      className="flex-1"
      data={ranking}
      keyExtractor={rankedKey}
      renderItem={renderItem}
      extraData={rowState}
      estimatedItemSize={grid.row}
      getFixedItemSize={() => grid.row}
      recycleItems
      contentContainerStyle={{ paddingHorizontal: grid.margin, paddingBottom: bottomInset }}
      ListHeaderComponent={header}
    />
  );
}

/** "No plays in the last 7 days", or "No plays yet" for all time. */
export const nothingPlayed = (period: StatsPeriod): string => {
  const label = STATS_PERIODS.find((option) => option.id === period)?.label;
  return period === "all" || label === undefined
    ? "No plays yet"
    : `No plays in the ${label.toLowerCase()}`;
};
