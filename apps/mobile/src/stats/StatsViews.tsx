import { IconChartBar } from "@tabler/icons-react-native";
import { LegendList } from "@legendapp/list/react-native";
import {
  counted,
  discoverTrackId,
  recapId,
  recapTitle,
  STATS_PERIODS,
  type QueueContext,
  type RecapPeriod,
  type StatsPeriod,
} from "@wave/core";
import { useCallback, useMemo, type ReactElement } from "react";
import { ScrollView, Text, useWindowDimensions, View } from "react-native";

import { CELL, grid } from "@/catalog/grid";
import { NameRow } from "@/catalog/NameRow";
import { SwipeTrackRow } from "@/library/SwipeTrackRow";
import { useChromeInset } from "@/chrome/chrome";
import { EmptyState } from "@/components/EmptyState";
import { useFavoriteIds } from "@/library/favorites";
import type { AlbumRow, ArtistRow } from "@/library/LibraryStore";
import { openAlbum, openArtist, openRecap } from "@/library/routes";
import { toTrackSummary } from "@/library/TrackList";
import { Press } from "@/motion/Press";
import { playRankedSongs } from "@/playback/actions";
import { useCurrentPlayingIds } from "@/playback/hooks";
import { openAlbumActions, openArtistActions, openTrackActions } from "@/playback/ActionsMenu";
import { ArtworkRow } from "@/search/ArtworkRow";
import { RankedYtSongRow } from "@/ytmusic/YtSongRow";

import type { Ranked, StatsSong } from "./Stats";
import { recapCardHeight } from "./recapAnnouncement";
import { useListScrollable } from "@/motion/heldTouch";

/** "3 plays", "1 play". */
export const playCount = (count: number): string => counted(count, "play");

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

/**
 * A ranked song: numbered by rank (the top one in ember), its counted plays in
 * the length's cell. A streamed song is a plain streamed row, dimmed while it
 * can't play.
 */
function RankedSongRow({
  entry: { item, countedPlays },
  index,
  songs,
  context,
  currentIds,
  favorites,
}: {
  entry: Ranked<StatsSong>;
  index: number;
  /** The whole ranking's songs: tapping a row plays them from it. */
  songs: readonly StatsSong[];
  context: QueueContext;
  currentIds: ReadonlySet<string>;
  favorites: ReadonlySet<number>;
}) {
  const onPress = () => void playRankedSongs(songs, index, context);
  const playing = currentIds.has(discoverTrackId(item));
  if (item.source === "stream")
    return (
      <RankedYtSongRow
        song={item.song}
        playing={playing}
        popularRank={index + 1}
        plays={countedPlays}
        onPress={onPress}
      />
    );
  const song = item.track;
  return (
    <SwipeTrackRow
      song={song}
      track={{ ...toTrackSummary(song), trackNumber: index + 1 }}
      plays={countedPlays}
      state={playing ? "playing" : undefined}
      favorite={favorites.has(song.id)}
      leading="number"
      topNumber={index === 0}
      onPress={onPress}
      onLongPress={() => openTrackActions(song)}
    />
  );
}

/** A song ranking's key: the song's queue id. */
const rankedSongKey = (entry: Ranked<StatsSong>): string => discoverTrackId(entry.item);

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
  const currentIds = useCurrentPlayingIds();
  const favorites = useFavoriteIds();
  const songs = ranking.map((entry) => entry.item);
  return (
    <View>
      {ranking.map((entry, index) => (
        <RankedSongRow
          key={rankedSongKey(entry)}
          entry={entry}
          index={index}
          songs={songs}
          context={context}
          currentIds={currentIds}
          favorites={favorites}
        />
      ))}
    </View>
  );
}

/** A ranked album: rank, cover, title over the album artist and its counted plays. */
function renderRankedAlbum({ item: album, countedPlays }: Ranked<AlbumRow>, index: number) {
  return (
    <ArtworkRow
      title={album.title}
      detail={`${album.albumArtist} · ${playCount(countedPlays)}`}
      artworkUri={album.thumbPath === null ? undefined : `file://${album.thumbPath}`}
      rank={{ number: index + 1, top: index === 0 }}
      onPress={() => openAlbum(album.id, album)}
      onLongPress={() => openAlbumActions(album)}
    />
  );
}

/** A ranked artist (credited by track artist): rank, name over its counted plays. */
function renderRankedArtist({ item: artist, countedPlays }: Ranked<ArtistRow>, index: number) {
  return (
    <NameRow
      name={artist.name}
      artist={artist}
      detail={playCount(countedPlays)}
      rank={{ number: index + 1, top: index === 0 }}
      onPress={() => openArtist(artist.id, artist)}
      onLongPress={() => openArtistActions(artist)}
    />
  );
}

/** An album ranking. Tapping an album opens it; long-press opens the album's menu. */
export function RankedAlbums({ ranking }: { ranking: readonly Ranked<AlbumRow>[] }) {
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
export function RankedArtists({ ranking }: { ranking: readonly Ranked<ArtistRow>[] }) {
  return (
    <View>
      {ranking.map((entry, index) => (
        <View key={entry.item.id}>{renderRankedArtist(entry, index)}</View>
      ))}
    </View>
  );
}

/** A See all list of albums or artists, virtualised like `RankedSongList`. */
function RankedEntityList<A extends { readonly id: number }>({
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
  ranking: readonly Ranked<AlbumRow>[];
  header?: ReactElement;
}) {
  return <RankedEntityList ranking={ranking} renderRow={renderRankedAlbum} header={header} />;
}

/** See all › Top artists: the Stats screen's rows, virtualised. */
export function RankedArtistList({
  ranking,
  header,
}: {
  ranking: readonly Ranked<ArtistRow>[];
  header?: ReactElement;
}) {
  return <RankedEntityList ranking={ranking} renderRow={renderRankedArtist} header={header} />;
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
  ranking: readonly Ranked<StatsSong>[];
  period: StatsPeriod;
  header?: ReactElement;
}) {
  const scrollable = useListScrollable();
  const bottomInset = useChromeInset();
  const currentIds = useCurrentPlayingIds();
  const favorites = useFavoriteIds();
  const rowState = useMemo(() => ({ currentIds, favorites }), [currentIds, favorites]);
  const songs = useMemo(() => ranking.map((entry) => entry.item), [ranking]);
  const context = useMemo(() => statsSongsContext(period), [period]);
  const renderItem = useCallback(
    ({ item, index }: { item: Ranked<StatsSong>; index: number }) => (
      <RankedSongRow
        entry={item}
        index={index}
        songs={songs}
        context={context}
        currentIds={currentIds}
        favorites={favorites}
      />
    ),
    [songs, context, currentIds, favorites],
  );
  return (
    <LegendList
      scrollEnabled={scrollable}
      className="flex-1"
      data={ranking}
      keyExtractor={rankedSongKey}
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

/** A Recap's tile on Stats' Recaps row. */
const RECAP_TILE = { width: CELL * 17, height: CELL * 21 } as const;

/**
 * How a Recap's tile and Home's card read, by period kind: a year's stand
 * apart from the months' by their label, their "ready" line and their colour
 * (purple for a year, indigo for a month).
 */
const RECAP_LOOK: {
  readonly [K in RecapPeriod["kind"]]: {
    readonly label: string;
    readonly ready: string;
    readonly colour: string;
  };
} = {
  month: { label: "Recap", ready: "Your Recap is ready", colour: "bg-recap-indigo" },
  year: { label: "Year in music", ready: "Your year in music is ready", colour: "bg-recap-purple" },
};

/**
 * Home's card for a new Recap (Core's `recapToAnnounce`), shown until it's
 * opened. Tapping it plays its stories.
 */
export function RecapCard({ period }: { period: RecapPeriod }) {
  const { fontScale } = useWindowDimensions();
  const { ready, colour } = RECAP_LOOK[period.kind];
  return (
    <Press
      accessibilityRole="button"
      accessibilityLabel={`${ready}: ${recapTitle(period)}`}
      onPress={() => openRecap(period)}
      haptic="selection"
      className={`rounded-2xl ${colour}`}
      style={{ padding: CELL * 2, gap: CELL / 2, minHeight: recapCardHeight(fontScale) }}
    >
      <Text className="font-sans text-footnote font-semibold text-on-recap opacity-80">
        {ready}
      </Text>
      <Text numberOfLines={1} className="font-sans text-title2 font-bold text-on-recap">
        {recapTitle(period)}
      </Text>
      <Text className="font-sans text-subheadline text-on-recap opacity-80">Tap to watch</Text>
    </Press>
  );
}

/**
 * Stats' Recaps row: a tile for every Recap, newest first (each year ahead
 * of its months), scrolling sideways to the screen's edges. Tapping one
 * plays its stories.
 */
export function RecapsRow({ recaps }: { recaps: readonly RecapPeriod[] }) {
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
          accessibilityLabel={`${recapTitle(period)} ${RECAP_LOOK[period.kind].label}`}
          onPress={() => openRecap(period)}
          haptic="selection"
          className={`justify-end rounded-2xl ${RECAP_LOOK[period.kind].colour}`}
          style={{ width: tileWidth, minHeight: RECAP_TILE.height, padding: CELL * 1.5 }}
        >
          <Text className="font-sans text-footnote font-semibold text-on-recap opacity-80">
            {RECAP_LOOK[period.kind].label}
          </Text>
          <Text className="font-sans text-title3 font-bold text-on-recap">
            {recapTitle(period).replace(" ", "\n")}
          </Text>
        </Press>
      ))}
    </ScrollView>
  );
}

/** The period's label: "Last 7 days", "All time"… */
export const periodLabel = (period: StatsPeriod): string =>
  STATS_PERIODS.find((option) => option.id === period)?.label ?? "";

/** "No plays in the last 7 days", or "No plays yet" for all time. */
const nothingPlayed = (period: StatsPeriod): string =>
  period === "all" ? "No plays yet" : `No plays in the ${periodLabel(period).toLowerCase()}`;

/** A ranking's empty state: nothing was played enough to count in `period`. */
export function NothingPlayed({ period }: { period: StatsPeriod }) {
  return (
    <EmptyState
      icon={IconChartBar}
      title={nothingPlayed(period)}
      // Core's counted-play rule (`isCountedPlay`).
      message="Songs you listen to for more than 15 seconds are counted here."
    />
  );
}
