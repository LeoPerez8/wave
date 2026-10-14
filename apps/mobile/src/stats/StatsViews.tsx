import { IconChartBar } from "@tabler/icons-react-native";
import { LegendList } from "@legendapp/list/react-native";
import { counted, STATS_PERIODS, type QueueContext, type StatsPeriod } from "@wave/core";
import { useCallback, useMemo, type ReactElement } from "react";
import { Text, View } from "react-native";

import { CELL, grid } from "@/catalog/grid";
import { NameRow } from "@/catalog/NameRow";
import { TrackRow } from "@/catalog/TrackRow";
import { useChromeInset } from "@/chrome/chrome";
import { EmptyState } from "@/components/EmptyState";
import { useFavoriteIds } from "@/library/favorites";
import type { AlbumRow, ArtistRow, SongRow } from "@/library/LibraryStore";
import { openAlbum, openArtist } from "@/library/routes";
import { toTrackSummary } from "@/library/TrackList";
import { Press } from "@/motion/Press";
import { playSongs } from "@/playback/actions";
import { useCurrentTrackId } from "@/playback/hooks";
import { openAlbumActions, openArtistActions, openTrackActions } from "@/playback/ActionsMenu";
import { ArtworkRow } from "@/search/ArtworkRow";

import type { Ranked } from "./Stats";
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

/** A ranked song: numbered by rank (the top one in ember), its counted plays in the length's cell. */
function RankedSongRow({
  entry: { item: song, countedPlays },
  index,
  songs,
  context,
  currentId,
  favorites,
}: {
  entry: Ranked<SongRow>;
  index: number;
  /** The whole ranking's songs: tapping a row plays them from it. */
  songs: readonly SongRow[];
  context: QueueContext;
  currentId: string | null;
  favorites: ReadonlySet<number>;
}) {
  return (
    <TrackRow
      track={{ ...toTrackSummary(song), trackNumber: index + 1 }}
      plays={countedPlays}
      state={String(song.id) === currentId ? "playing" : undefined}
      favorite={favorites.has(song.id)}
      leading="number"
      topNumber={index === 0}
      onPress={() => playSongs(songs, index, context)}
      onLongPress={() => openTrackActions(song)}
    />
  );
}

/**
 * A song ranking: each row numbered by rank (the top one in ember), with its
 * counted plays where other lists show the length. Tapping a song plays the ranking from it;
 * long-press opens the song's menu.
 */
export function RankedSongs({
  ranking,
  context,
}: {
  ranking: readonly Ranked<SongRow>[];
  /** What tapping a song plays: the ranking, from the song (see `statsSongsContext`). */
  context: QueueContext;
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
          context={context}
          currentId={currentId}
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
  ranking: readonly Ranked<SongRow>[];
  period: StatsPeriod;
  header?: ReactElement;
}) {
  const scrollable = useListScrollable();
  const bottomInset = useChromeInset();
  const currentId = useCurrentTrackId();
  const favorites = useFavoriteIds();
  const rowState = useMemo(() => ({ currentId, favorites }), [currentId, favorites]);
  const songs = useMemo(() => ranking.map((entry) => entry.item), [ranking]);
  const context = useMemo(() => statsSongsContext(period), [period]);
  const renderItem = useCallback(
    ({ item, index }: { item: Ranked<SongRow>; index: number }) => (
      <RankedSongRow
        entry={item}
        index={index}
        songs={songs}
        context={context}
        currentId={currentId}
        favorites={favorites}
      />
    ),
    [songs, context, currentId, favorites],
  );
  return (
    <LegendList
      scrollEnabled={scrollable}
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
