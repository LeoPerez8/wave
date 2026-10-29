import { useLocalisation } from "@/localisation/localisation";
import { usePositions } from "@/lib/usePositions";
import type { PlayedAlbum, PlayedArtist } from "@/library/db/playedEntities";
import { PlayedAlbumRow, PlayedArtistRow } from "./PlayedEntityViews";
import { IconChartBar } from "@tabler/icons-react-native";
import { LegendList } from "@legendapp/list/react-native";
import {
  statsPeriods,
  discoverTrackId,
  recapId,
  recapTitle,
  type Catalogue,
  type QueueContext,
  type RecapPeriod,
  type RowMenuAction,
  type StatsPeriod,
} from "@wave/core";
import { useCallback, useMemo, type ReactElement } from "react";
import { ScrollView, Text, useWindowDimensions, View } from "react-native";

import { CELL, grid } from "@/catalog/grid";
import { useChromeInset } from "@/chrome/chrome";
import { EmptyState } from "@/components/EmptyState";
import { openRecap } from "@/library/routes";
import { Press } from "@/motion/Press";
import { TextButton } from "@/components/TextButton";
import { playPlaylist } from "@/playback/actions";
import { mixedSongEntry, openMixedSongActions, runMixedSongSwipe } from "@/songs/mixedSongs";
import { SongList, SongPreview } from "@/songs/SongList";

import type { Ranked, StatsSong } from "./Stats";
import { recapCardHeight } from "./recapAnnouncement";
import { useListScrollable } from "@/motion/heldTouch";

/** What tapping a song in a period's song ranking plays: that ranking. */
export const statsSongsContext = (period: StatsPeriod): QueueContext => ({
  kind: "stats",
  id: `songs-${period}`,
});

/** The period selector: text tabs, the selected one in ink with a teal underline. */
export function PeriodTabs({
  period,
  onChange,
}: {
  period: StatsPeriod;
  onChange: (period: StatsPeriod) => void;
}) {
  const { strings } = useLocalisation();
  return (
    // Wraps rather than clips at large font scales.
    <View
      accessibilityRole="tablist"
      className="flex-row flex-wrap"
      style={{ columnGap: CELL * 3 }}
    >
      {statsPeriods(strings).map((option) => {
        const selected = option.id === period;
        return (
          <TextButton
            key={option.id}
            label={option.tab}
            accessibilityLabel={option.label}
            accessibilityRole="tab"
            variant="segment"
            selected={selected}
            onPress={() => onChange(option.id)}
          />
        );
      })}
    </View>
  );
}

/**
 * A ranked song: numbered by rank (the top one in ember), its counted plays in
 * the length's cell. A streamed song is a plain streamed row, dimmed with its
 * tap doing nothing while it can't play.
 */
const rankedSongEntry = (entry: Ranked<StatsSong>, rank: number, strings: Catalogue) =>
  mixedSongEntry(
    entry.item,
    {
      leading: { kind: "rank", number: rank },
      trailingLabel: strings.stats.plays(entry.countedPlays),
    },
    true,
  );

/** A song ranking's key: the song's queue id. */
const rankedSongKey = (entry: Ranked<StatsSong>): string => discoverTrackId(entry.item);

/** A ranking's rows, rank and play order, for a preview or its See all. */
const useRankedSongRows = (ranking: readonly Ranked<StatsSong>[], context: QueueContext) => {
  const songs = useMemo(() => ranking.map((entry) => entry.item), [ranking]);
  const { strings } = useLocalisation();
  const places = usePositions(ranking);
  const song = useCallback(
    (entry: Ranked<StatsSong>) => rankedSongEntry(entry, (places.get(entry) ?? 0) + 1, strings),
    [places, strings],
  );
  return {
    data: ranking,
    keyExtractor: rankedSongKey,
    song,
    context,
    onPlay: (entry: Ranked<StatsSong>) => void playPlaylist(songs, places.get(entry), context),
    onMenu: (entry: Ranked<StatsSong>) => openMixedSongActions(entry.item),
    onSongSwipe: (entry: Ranked<StatsSong>, shown: RowMenuAction) =>
      runMixedSongSwipe(entry.item, shown),
  };
};

/**
 * A song ranking: each row numbered by rank (the top one in ember), with its
 * counted plays where other lists show the length. Tapping a song plays the ranking from it;
 * long-press opens the song's menu.
 */
export function RankedSongs({
  ranking,
  context,
}: {
  ranking: readonly Ranked<StatsSong>[];
  /** What tapping a song plays: the ranking, from the song (see `statsSongsContext`). */
  context: QueueContext;
}) {
  return <SongPreview {...useRankedSongRows(ranking, context)} />;
}

/** A ranked album: rank, cover, title over the album artist and its counted plays. */
function RankedAlbumRow({ entry, index }: { entry: Ranked<PlayedAlbum>; index: number }) {
  const { strings } = useLocalisation();
  return (
    <PlayedAlbumRow
      album={entry.item}
      detail={strings.stats.plays(entry.countedPlays)}
      index={index}
    />
  );
}

/** A ranked artist, including a streamed artist absent from the Library. */
function RankedArtistRow({ entry, index }: { entry: Ranked<PlayedArtist>; index: number }) {
  const { strings } = useLocalisation();
  return (
    <PlayedArtistRow
      artist={entry.item}
      detail={strings.stats.plays(entry.countedPlays)}
      index={index}
    />
  );
}

function renderRankedAlbum(entry: Ranked<PlayedAlbum>, index: number) {
  return <RankedAlbumRow entry={entry} index={index} />;
}

function renderRankedArtist(entry: Ranked<PlayedArtist>, index: number) {
  return <RankedArtistRow entry={entry} index={index} />;
}

/** An album ranking. Tapping an album opens it; long-press opens the album's menu. */
export function RankedAlbums({ ranking }: { ranking: readonly Ranked<PlayedAlbum>[] }) {
  return (
    <View>
      {ranking.map((entry, index) => (
        <View key={entry.item.id}>{renderRankedAlbum(entry, index)}</View>
      ))}
    </View>
  );
}

/**
 * An artist ranking, credited by track artist. Tapping an artist opens it;
 * long-press opens the artist's menu.
 */
export function RankedArtists({ ranking }: { ranking: readonly Ranked<PlayedArtist>[] }) {
  return (
    <View>
      {ranking.map((entry, index) => (
        <View key={entry.item.id}>{renderRankedArtist(entry, index)}</View>
      ))}
    </View>
  );
}

/** A See all list of albums or artists, virtualised like `RankedSongList`. */
function RankedEntityList<A extends { readonly id: number | string }>({
  ranking,
  renderRow,
  header,
}: {
  ranking: readonly Ranked<A>[];
  renderRow: (entry: Ranked<A>, index: number) => ReactElement;
  header?: ReactElement | undefined;
}) {
  const scrollable = useListScrollable();
  const bottomInset = useChromeInset();
  const renderItem = useCallback(
    ({ item, index }: { item: Ranked<A>; index: number }) => renderRow(item, index),
    [renderRow],
  );
  return (
    <LegendList
      scrollEnabled={scrollable}
      className="flex-1"
      data={ranking}
      keyExtractor={rankedKey}
      renderItem={renderItem}
      estimatedItemSize={grid.row}
      getFixedItemSize={() => grid.row}
      recycleItems
      contentContainerStyle={{ paddingHorizontal: grid.margin, paddingBottom: bottomInset }}
      ListHeaderComponent={header}
    />
  );
}

/** See all › Top albums: the Stats screen's rows, virtualised. */
export function RankedAlbumList({
  ranking,
  header,
}: {
  ranking: readonly Ranked<PlayedAlbum>[];
  header?: ReactElement;
}) {
  return <RankedEntityList ranking={ranking} renderRow={renderRankedAlbum} header={header} />;
}

/** See all › Top artists: the Stats screen's rows, virtualised. */
export function RankedArtistList({
  ranking,
  header,
}: {
  ranking: readonly Ranked<PlayedArtist>[];
  header?: ReactElement;
}) {
  return <RankedEntityList ranking={ranking} renderRow={renderRankedArtist} header={header} />;
}

/** A See all list's key: the ranked entity's id. */
export const rankedKey = (entry: Ranked<{ readonly id: number | string }>): string =>
  String(entry.item.id);

/**
 * See all › Top songs: the Stats screen's rows, virtualised. Tap and
 * long-press behave as on the Stats screen.
 */
export function RankedSongList({
  ranking,
  period,
  header,
}: {
  ranking: readonly Ranked<StatsSong>[];
  period: StatsPeriod;
  header?: ReactElement;
}) {
  const scrollable = useListScrollable();
  const bottomInset = useChromeInset();
  const context = useMemo(() => statsSongsContext(period), [period]);
  return (
    <View className="flex-1">
      <SongList
        {...useRankedSongRows(ranking, context)}
        scrollEnabled={scrollable}
        className="flex-1"
        contentContainerStyle={{ paddingHorizontal: grid.margin, paddingBottom: bottomInset }}
        ListHeaderComponent={header}
      />
    </View>
  );
}

/** A Recap's tile on Stats' Recaps row. */
const RECAP_TILE = { width: CELL * 17, height: CELL * 21 } as const;

/**
 * A Recap's tile and Home's card stand a year's apart from the months' by
 * their label and "ready" line (the catalogue's `recap.kinds`, `recap.ready`)
 * and their colour: purple for a year, indigo for a month.
 */
const RECAP_COLOUR: { readonly [K in RecapPeriod["kind"]]: string } = {
  month: "bg-recap-indigo",
  year: "bg-recap-purple",
};

/**
 * Home's card for a new Recap (Core's `recapToAnnounce`), shown until it's
 * opened. Tapping it plays its stories.
 */
export function RecapCard({ period }: { period: RecapPeriod }) {
  const { strings } = useLocalisation();
  const { fontScale } = useWindowDimensions();
  const ready = strings.recap.ready[period.kind];
  const colour = RECAP_COLOUR[period.kind];
  return (
    <Press
      accessibilityRole="button"
      accessibilityLabel={`${ready}: ${recapTitle(period, strings)}`}
      onPress={() => openRecap(period)}
      haptic="selection"
      className={`rounded-2xl ${colour}`}
      style={{ padding: CELL * 2, gap: CELL / 2, minHeight: recapCardHeight(fontScale) }}
    >
      <Text className="font-sans text-footnote font-semibold text-on-recap opacity-80">
        {ready}
      </Text>
      <Text numberOfLines={1} className="font-sans text-title2 font-bold text-on-recap">
        {recapTitle(period, strings)}
      </Text>
      <Text className="font-sans text-subheadline text-on-recap opacity-80">
        {strings.recap.tapToWatch}
      </Text>
    </Press>
  );
}

/**
 * Stats' Recaps row: a tile for every Recap, newest first (each year ahead
 * of its months), scrolling sideways to the screen's edges. Tapping one
 * plays its stories.
 */
export function RecapsRow({ recaps }: { recaps: readonly RecapPeriod[] }) {
  const { strings } = useLocalisation();
  const { fontScale } = useWindowDimensions();
  // Keep full month names readable as system type grows, on the catalog's cell grid.
  const tileWidth = Math.ceil((RECAP_TILE.width * Math.max(1, fontScale)) / CELL) * CELL;
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={{ marginHorizontal: -grid.margin }}
      contentContainerStyle={{ paddingHorizontal: grid.margin, gap: CELL * 1.5 }}
    >
      {recaps.map((period) => (
        <Press
          key={recapId(period)}
          accessibilityRole="button"
          accessibilityLabel={strings.recap.tileLabel(period)}
          onPress={() => openRecap(period)}
          haptic="selection"
          className={`justify-end rounded-2xl ${RECAP_COLOUR[period.kind]}`}
          style={{ width: tileWidth, minHeight: RECAP_TILE.height, padding: CELL * 1.5 }}
        >
          <Text className="font-sans text-footnote font-semibold text-on-recap opacity-80">
            {strings.recap.kinds[period.kind]}
          </Text>
          <Text className="font-sans text-title3 font-bold text-on-recap">
            {recapTitle(period, strings).replace(" ", "\n")}
          </Text>
        </Press>
      ))}
    </ScrollView>
  );
}

/** A ranking's empty state: nothing was played enough to count in `period`. */
export function NothingPlayed({ period }: { period: StatsPeriod }) {
  const { strings } = useLocalisation();
  return (
    <EmptyState
      icon={IconChartBar}
      // "No plays in the last 7 days", or "No plays yet" for all time.
      title={strings.stats.noPlays[period]}
      // Core's counted-play rule (`isCountedPlay`).
      message={strings.stats.countedHint}
    />
  );
}
