import { LegendList, type LegendListRef } from "@legendapp/list/react-native";
import { songSpineKeys, type QueueContext, type SongSort } from "@wave/core";
import { useCallback, useMemo, useRef, type ReactElement, type ReactNode } from "react";
import { View } from "react-native";

import { AlphabetSpine } from "@/catalog/AlphabetSpine";
import { CatalogLine } from "@/catalog/CatalogLine";
import { CELL, grid } from "@/catalog/grid";
import { PlayShuffle } from "@/catalog/PlayShuffle";
import { type TrackSummary, TrackRow } from "@/catalog/TrackRow";
import { useChromeInset } from "@/chrome/chrome";
import { playSongs } from "@/playback/actions";
import { useCurrentTrackId } from "@/playback/hooks";
import { openTrackActions } from "@/playback/TrackActionsSheet";

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
});

export const songCount = (count: number): string =>
  `${count.toLocaleString("en")} ${count === 1 ? "song" : "songs"}`;

/**
 * A list's opening: a catalog line (the count, a path…) over Play and Shuffle,
 * with the list's sort control (if any) on the right.
 */
export function ListIntro({
  line,
  songs,
  context,
  sortControl,
}: {
  line: string;
  /** In the order the list shows them: Play and Shuffle play them so. */
  songs: readonly SongRow[];
  context: QueueContext;
  sortControl?: ReactNode;
}) {
  return (
    <View style={{ gap: CELL, paddingBottom: CELL }}>
      <CatalogLine>{line}</CatalogLine>
      <View className="flex-row items-center justify-between">
        <PlayShuffle
          onPlay={() => playSongs(songs, undefined, context, { shuffle: false })}
          onShuffle={() => playSongs(songs, undefined, context, { shuffle: true })}
        />
        {sortControl}
      </View>
    </View>
  );
}

const NO_KEYS: readonly string[] = [];

const keyExtractor = (song: SongRow): string => String(song.id);

type Props = {
  songs: readonly SongRow[];
  /** What tapping a row plays: this whole list, from the row. */
  context: QueueContext;
  header?: ReactElement;
  /**
   * The sort the songs are in; the A–Z spine follows it (none for date added).
   * Lists in an order of their own (a folder's files, Favorites) omit it and go without a spine.
   */
  sort?: SongSort | undefined;
};

/**
 * Tracks with thumbnails (Songs, a genre, a folder, an artist's songs),
 * virtualised for tens of thousands of rows. Tap plays the list from the row;
 * long-press opens the track's menu.
 */
export function TrackList({ songs, context, header, sort }: Props) {
  const scrollable = useListScrollable();
  const list = useRef<LegendListRef>(null);
  const bottomInset = useChromeInset();
  const currentId = useCurrentTrackId();
  const favorites = useFavoriteIds();
  const rowState = useMemo(() => ({ currentId, favorites }), [currentId, favorites]);
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
        onPress={() => playSongs(songs, index, context)}
        onLongPress={() => openTrackActions(item)}
      />
    ),
    [context, currentId, favorites, songs],
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
          // Lets the last row scroll out from under the floating mini player.
          paddingBottom: bottomInset,
        }}
        ListHeaderComponent={header}
      />
      {spine.show && <AlphabetSpine letters={spine.letters} onLetter={spine.onLetter} />}
    </View>
  );
}
