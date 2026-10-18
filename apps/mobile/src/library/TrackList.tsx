import { LegendList, type LegendListRef } from "@legendapp/list/react-native";
import { useScrollToTop } from "expo-router";
import {
  counted,
  showsExplicitBadge,
  songSpineKeys,
  type MixedSong,
  type QueueContext,
  type SongSort,
  type YtSong,
} from "@wave/core";
import { useCallback, useMemo, useRef, type ReactElement, type ReactNode } from "react";
import { View } from "react-native";

import { AlphabetSpine } from "@/catalog/AlphabetSpine";
import { CatalogLine } from "@/catalog/CatalogLine";
import { CELL, grid } from "@/catalog/grid";
import { PlayShuffle, type LineToggle } from "@/catalog/PlayShuffle";
import { type TrackSummary, TrackRow } from "@/catalog/TrackRow";
import { useChromeInset } from "@/chrome/chrome";
import { useRenderCount } from "@/perf/perf";
import { playSongs } from "@/playback/actions";
import { useCurrentTrackId, usePlayPage } from "@/playback/hooks";
import { openTrackActions } from "@/playback/ActionsMenu";
import type { ActionItems } from "@/playback/actionTargets";
import { selectableRow } from "@/selection/selectableRow";
import { useListSelection } from "@/selection/useListSelection";

import { useFavoriteIds } from "./favorites";
import type { SongRow } from "./LibraryStore";
import { useSpine } from "./useSpine";
import { useListScrollable } from "@/motion/heldTouch";

export const toTrackSummary = (song: SongRow): TrackSummary => ({
  id: String(song.id),
  title: song.title,
  artist: song.artist,
  durationMs: song.durationMs,
  artworkUri: song.thumbPath === null ? undefined : `file://${song.thumbPath}`,
  // A missing song: dimmed, as a YT Music song not downloaded is.
  missingTrackId: song.path === null ? song.id : undefined,
  explicit: showsExplicitBadge(song.explicit),
});

export const songCount = (count: number): string => counted(count, "song");

/**
 * A list's opening: a catalog line (the count, a path…) over Play and Shuffle
 * (and the Library | Online toggle, if any), with the list's sort control (if
 * any) on the right.
 */
export function ListIntro({
  line,
  songs,
  mixed,
  context,
  sortControl,
  toggle,
}: {
  line: string;
  /**
   * In the order the list shows them: Play and Shuffle play them so.
   * Undefined while they load: a press then plays them once read.
   */
  songs: readonly SongRow[] | undefined;
  /**
   * A page that can be integrated (an artist's): its whole list, the Library's
   * songs and YouTube Music's in page order, played instead of [songs] (by
   * `playPage`, so streams only in an integrated view).
   */
  mixed?: readonly MixedSong<YtSong, SongRow>[] | undefined;
  context: QueueContext;
  sortControl?: ReactNode;
  /** The Library | Online toggle after Play and Shuffle (an artist's page, YT Music on). */
  toggle?: LineToggle | null;
}) {
  const library = useMemo(
    () => songs?.map((track) => ({ source: "library" as const, track })),
    [songs],
  );
  const play = usePlayPage(mixed ?? library, context);
  return (
    <ListIntroLayout
      line={line}
      onPlay={() => play(false)}
      onShuffle={() => play(true)}
      sortControl={sortControl}
      toggle={toggle}
    />
  );
}

/**
 * What `ListIntro` draws: [line] over Play and Shuffle (and the Library |
 * Online toggle, if any), [sortControl] (if any) on the right. The Design
 * preview draws it too, on synthetic songs.
 */
export function ListIntroLayout({
  line,
  onPlay,
  onShuffle,
  sortControl,
  toggle,
}: {
  line: string;
  onPlay: () => void;
  onShuffle: () => void;
  sortControl?: ReactNode;
  toggle?: LineToggle | null;
}) {
  return (
    <View style={{ gap: CELL, paddingBottom: CELL }}>
      <CatalogLine>{line}</CatalogLine>
      <View className="flex-row items-center justify-between">
        <PlayShuffle onPlay={onPlay} onShuffle={onShuffle} toggle={toggle} />
        {sortControl !== undefined && (
          // Its glyph sits on the right margin, like Back on the left.
          <View className="-mr-3">{sortControl}</View>
        )}
      </View>
    </View>
  );
}

const NO_KEYS: readonly string[] = [];

const keyExtractor = (song: SongRow): string => String(song.id);

/** The actions in selection mode act on the checked songs. */
const tracksOf = (songs: readonly SongRow[]): ActionItems => ({
  kind: "track",
  items: songs.map((song) => ({ song })),
});

type Props = {
  songs: readonly SongRow[];
  /** What tapping a row plays: this whole list, from the row. */
  context: QueueContext;
  header?: ReactElement;
  /**
   * The sort the songs are in; the A–Z spine follows it (none for the date and
   * file-name sorts). Without it the list goes without a spine.
   */
  sort?: SongSort | undefined;
};

/**
 * Tracks with thumbnails (Songs, a genre, an artist's songs),
 * virtualised for tens of thousands of rows. Tap plays the list from the row;
 * long-press opens the track's menu, whose Select starts selection mode: then
 * every row shows a check cell and taps check and uncheck.
 */
export function TrackList({ songs, context, header, sort }: Props) {
  useRenderCount("TrackList");
  const scrollable = useListScrollable();
  const list = useRef<LegendListRef>(null);
  useScrollToTop(list);
  const bottomInset = useChromeInset();
  const currentId = useCurrentTrackId();
  const favorites = useFavoriteIds();
  const listSelection = useListSelection({
    items: songs,
    keyOf: keyExtractor,
    target: tracksOf,
  });
  const rowState = useMemo(
    () => ({ currentId, favorites, selection: listSelection.selection }),
    [currentId, favorites, listSelection.selection],
  );
  const sortKeys = useMemo(
    () => (sort === undefined ? NO_KEYS : (songSpineKeys(songs, sort) ?? NO_KEYS)),
    [sort, songs],
  );
  const spine = useSpine(sortKeys, list);

  const renderItem = useCallback(
    ({ item, index }: { item: SongRow; index: number }) => (
      <TrackRow
        track={toTrackSummary(item)}
        state={String(item.id) === currentId ? "playing" : undefined}
        favorite={favorites.has(item.id)}
        leading="artwork"
        {...selectableRow(
          item,
          listSelection,
          () => playSongs(songs, index, context),
          (options) => openTrackActions(item, options),
        )}
      />
    ),
    [context, currentId, favorites, songs, listSelection],
  );

  return (
    <View className="flex-1">
      <LegendList
        scrollEnabled={scrollable}
        ref={list}
        className="flex-1"
        data={songs}
        keyExtractor={keyExtractor}
        renderItem={renderItem}
        extraData={rowState}
        estimatedItemSize={grid.row}
        getFixedItemSize={() => grid.row}
        recycleItems
        contentContainerStyle={{
          paddingLeft: grid.margin,
          paddingRight: spine.paddingRight,
          // Lets the last row scroll out from under the floating mini player (or selection bar).
          paddingBottom: bottomInset,
        }}
        ListHeaderComponent={header}
      />
      {spine.show && (
        <AlphabetSpine entries={spine.entries} onJump={spine.onJump} topRow={spine.topRow} />
      )}
    </View>
  );
}
