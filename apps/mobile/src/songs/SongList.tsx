import {
  LegendList,
  type LegendListRef,
  type LegendListProps,
  type LegendListRenderItemProps,
} from "@legendapp/list/react-native";
import {
  missingSongJobId,
  songRowSwipeDirections,
  streamedArtistLink,
  ytDownloadStatus,
  type QueueContext,
  type RowSwipeSide,
} from "@wave/core";
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ReactElement, ReactNode, Ref } from "react";
import { View } from "react-native";

import { AlphabetSpine } from "@/catalog/AlphabetSpine";
import { CatalogLine } from "@/catalog/CatalogLine";
import { CELL, grid } from "@/catalog/grid";
import { useFavoriteIds, usePendingFavoriteVideos } from "@/library/favorites";
import { useCurrentPath } from "@/library/routes";
import type { Spine } from "@/library/useSpine";
import { useRenderCount } from "@/perf/perf";
import { useCurrentPlayingIds } from "@/playback/hooks";
import { lyricsAndGenreLookupsEnabled } from "@/settings/lyricsAndGenre";
import { useSwipeSettings } from "@/settings/swipeActions";
import { useYtMusicEnabled } from "@/settings/ytMusic";
import { knownLibraryFinder } from "@/ytmusic/libraryFinder";
import { ytAlbumPageHere } from "@/ytmusic/routes";
import { streamedArtistContextNow } from "@/ytmusic/streamedArtist";
import { useSongListDownloads } from "@/ytmusic/YtDownloads";
import { SongRow } from "./SongRow";
import { createSongListModel } from "./songListModel";
import type { SongListEntry } from "./songListSources";
import type { NativeYtSong } from "@/native/waveYtMusic";
import type { MenuOptions } from "@/playback/ActionsMenu";

export interface SongListSelection<T> {
  readonly selecting: boolean;
  readonly isChecked: (item: T) => boolean;
  readonly toggle: (item: T) => void;
  readonly start: (item: T) => void;
}

export type SongListProps<T> = Omit<
  LegendListProps<T>,
  "renderItem" | "getItemType" | "getFixedItemSize" | "recycleItems"
> & {
  readonly ref?: Ref<LegendListRef> | undefined;
  readonly data: readonly T[];
  readonly keyExtractor: (item: T, index: number) => string;
  /** Null delegates a typed non-song slot to renderSlot. */
  readonly song: (item: T) => SongListEntry | null;
  readonly context: QueueContext;
  readonly onPlay: (item: T, context: QueueContext) => void;
  readonly onMenu: (item: T, options: MenuOptions) => void;
  readonly onSongSwipe?: ((item: T, side: RowSwipeSide) => void) | undefined;
  readonly selection?: SongListSelection<T> | undefined;
  readonly spine?: Spine | undefined;
  readonly decorateRow?: ((row: ReactElement, item: T) => ReactNode) | undefined;
  readonly renderSlot?: ((props: LegendListRenderItemProps<T>) => ReactNode) | undefined;
  readonly slotType?: ((item: T) => string) | undefined;
  readonly slotSize?: ((item: T) => number) | undefined;
};

/** The list owns subscriptions. Recycled leaves receive primitive display props and stable actions. */
export function SongList<T>({
  data,
  keyExtractor,
  song,
  context,
  onPlay,
  onMenu,
  onSongSwipe,
  selection,
  spine,
  renderSlot,
  decorateRow,
  slotType,
  slotSize,
  extraData,
  ...list
}: SongListProps<T>) {
  useRenderCount("SongList");
  // Followed only while the list's screen is in sight (#722): a hidden tab renders nothing here.
  const currentIds = useCurrentPlayingIds();
  const favorites = useFavoriteIds();
  const pending = usePendingFavoriteVideos();
  const downloads = useSongListDownloads();
  const settings = useSwipeSettings();
  const here = useCurrentPath(false);
  const ytMusic = useYtMusicEnabled();
  const [model] = useState(createSongListModel);
  const items = useMemo(
    () => new Map(data.map((item, index) => [keyExtractor(item, index), item])),
    [data, keyExtractor],
  );
  const latest = useRef({ items, context, onPlay, onMenu, onSongSwipe, selection });
  useLayoutEffect(() => {
    latest.current = { items, context, onPlay, onMenu, onSongSwipe, selection };
  });
  const press = useCallback((key: string) => {
    const current = latest.current;
    const item = current.items.get(key);
    if (item === undefined) return;
    if (current.selection?.selecting) current.selection.toggle(item);
    else current.onPlay(item, current.context);
  }, []);
  const menu = useCallback((key: string) => {
    const current = latest.current;
    const item = current.items.get(key);
    if (item === undefined || current.selection?.selecting) return;
    current.onMenu(
      item,
      current.selection === undefined ? {} : { onSelect: () => current.selection?.start(item) },
    );
  }, []);
  const swipe = useCallback((key: string, side: RowSwipeSide) => {
    const current = latest.current;
    const item = current.items.get(key);
    if (item !== undefined && !current.selection?.selecting) current.onSongSwipe?.(item, side);
  }, []);
  const row = useCallback(
    ({ item, index, ...rest }: LegendListRenderItemProps<T>) => {
      const entry = song(item);
      if (entry === null) return renderSlot?.({ item, index, ...rest }) ?? null;
      const { source } = entry;
      const key = keyExtractor(item, index);
      const trackId =
        source.kind === "library" || source.kind === "librarySummary" || source.kind === "missing"
          ? String(source.song.id)
          : source.kind === "ytMusic"
            ? `yt:${source.song.videoId}`
            : key;
      const remote = source.kind === "ytMusic";
      const starred = remote ? pending.has(source.song.videoId) : favorites.has(Number(trackId));
      const job = remote
        ? source.song.videoId
        : entry.facts?.missing
          ? missingSongJobId(Number(trackId))
          : null;
      const download = job === null ? null : ytDownloadStatus(downloads, job);
      const shown = model.row(
        source,
        {
          ...entry.state,
          playing: currentIds.has(trackId),
          starred,
          download,
          remoteArtwork: ytMusic,
          selection: selection?.selecting
            ? selection.isChecked(item)
              ? "checked"
              : "unchecked"
            : "off",
        },
        key,
      );
      if (source.kind === "discHeader")
        return (
          <View
            className="justify-end"
            style={{ height: CELL * 6, paddingBottom: CELL }}
            accessibilityRole={shown.accessibilityRole}
            accessibilityLabel={shown.accessibilityLabel}
          >
            <CatalogLine>{shown.title}</CatalogLine>
          </View>
        );
      const directions =
        onSongSwipe === undefined || shown.selecting || shown.disabled
          ? { right: null, left: null }
          : remote
            ? songRowSwipeDirections(
                {
                  kind: "ytMusic",
                  options: {
                    favorite: starred,
                    album: (source.song as NativeYtSong).albumId,
                    ytAlbumHere: ytAlbumPageHere(here),
                    ytMusic,
                  },
                  download,
                  inLibrary:
                    knownLibraryFinder() === null || knownLibraryFinder()?.(source.song) != null,
                  artists: streamedArtistLink(
                    source.song.artists ?? [],
                    streamedArtistContextNow(),
                  ),
                },
                settings,
              )
            : entry.facts === undefined
              ? { right: null, left: null }
              : songRowSwipeDirections(
                  {
                    kind: "track",
                    item: { ...entry.facts, favorite: starred, download },
                    here,
                    onlineLookups: lyricsAndGenreLookupsEnabled(),
                  },
                  settings,
                );
      const rendered = (
        <SongRow
          {...shown}
          onPress={press}
          onLongPress={menu}
          onSwipe={swipe}
          swipeRight={directions.right}
          swipeLeft={directions.left}
        />
      );
      return decorateRow === undefined ? rendered : decorateRow(rendered, item);
    },
    [
      decorateRow,
      song,
      renderSlot,
      keyExtractor,
      model,
      currentIds,
      favorites,
      pending,
      downloads,
      selection,
      settings,
      here,
      ytMusic,
      onSongSwipe,
      press,
      menu,
      swipe,
    ],
  );
  const state = useMemo(
    () => ({
      currentIds,
      favorites,
      pending,
      downloads,
      selection,
      settings,
      here,
      ytMusic,
      extraData,
    }),
    [currentIds, favorites, pending, downloads, selection, settings, here, ytMusic, extraData],
  );
  return (
    <>
      <LegendList
        {...list}
        data={data}
        keyExtractor={keyExtractor}
        renderItem={row}
        extraData={state}
        recycleItems
        estimatedItemSize={grid.row}
        getItemType={(item) => {
          const entry = song(item);
          return entry === null
            ? `slot:${slotType?.(item) ?? "custom"}`
            : model.identity(entry.source).recycleType;
        }}
        getFixedItemSize={(item) => {
          const entry = song(item);
          return entry === null
            ? (slotSize?.(item) ?? grid.row)
            : entry.source.kind === "discHeader"
              ? CELL * 6
              : grid.row;
        }}
      />
      {spine?.show && (
        <AlphabetSpine entries={spine.entries} onJump={spine.onJump} topRow={spine.topRow} />
      )}
    </>
  );
}
