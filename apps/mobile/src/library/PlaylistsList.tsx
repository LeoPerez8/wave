import { LegendList, type LegendListRef } from "@legendapp/list/react-native";
import { IconPlaylist } from "@tabler/icons-react-native";
import { counted, playlistLayoutRows, type PlaylistLayout } from "@wave/core";
import { useScrollToTop } from "expo-router";
import { useCallback, useMemo, useRef, type ReactNode } from "react";
import { useWindowDimensions, View } from "react-native";

import { CatalogLine } from "@/catalog/CatalogLine";
import { CELL, grid } from "@/catalog/grid";
import { PlaylistEntry } from "@/catalog/PlaylistEntry";
import { PlaylistTile } from "@/catalog/PlaylistTile";
import { playlistTileRowHeight } from "@/catalog/playlistTileSize";
import { useChromeInset } from "@/chrome/chrome";
import { EmptyState } from "@/components/EmptyState";
import { TextButton } from "@/components/TextButton";
import { openPlaylistActions } from "@/playback/ActionsMenu";
import type { ActionItems } from "@/playback/actionTargets";
import { selectableRow } from "@/selection/selectableRow";
import { useListSelection, type ListSelection } from "@/selection/useListSelection";

import { usePlaylists } from "./hooks";
import { openPlaylistImport } from "./importPlaylistLink";
import type { PlaylistRow } from "./LibraryStore";
import { usePlaylistLayout } from "./playlistLayout";
import { emptyPlaylistRow } from "./playlists";
import { newPlaylist } from "./PlaylistSheets";
import { openPlaylist } from "./routes";
import { songCount } from "./TrackList";
import { useListScrollable } from "@/motion/heldTouch";
import { useYtMusicEnabled } from "@/settings/ytMusic";

/** Makes an empty playlist and opens it. */
const createAndOpen = (): void => {
  void newPlaylist().then((created) => {
    if (created !== null) openPlaylist(created.id, emptyPlaylistRow(created.id, created.name));
  });
};

const keyOf = (playlist: PlaylistRow): string => String(playlist.id);

/** In selection mode the actions act on the checked playlists (their songs, by Core's `groupSongs`). */
const playlistsOf = (playlists: readonly PlaylistRow[]): ActionItems => ({
  kind: "playlist",
  items: playlists,
});

/** A row of the list: its playlists' keys. */
const rowKey = (row: readonly PlaylistRow[]): string => row.map(keyOf).join(",");

/**
 * Tap opens the playlist; long-press opens its menu, which offers Select.
 * While selecting, taps check and uncheck.
 */
const playlistPress = (playlist: PlaylistRow, selection: ListSelection<PlaylistRow>) =>
  selectableRow(
    playlist,
    selection,
    () => openPlaylist(playlist.id, playlist),
    (options) => openPlaylistActions(playlist, options),
  );

/**
 * A row of playlists as [layout] shows them: one row with a small mosaic
 * (list), two tiles with their counts (grid), or one full-width card (large).
 * While selecting, each shows a check.
 */
function PlaylistsRow({
  row,
  layout,
  tile,
  selection,
}: {
  row: readonly PlaylistRow[];
  layout: PlaylistLayout;
  /** The cover's side for this layout's tiles. */
  tile: number;
  selection: ListSelection<PlaylistRow>;
}) {
  if (layout === "list") {
    return row.map((playlist) => (
      <PlaylistEntry
        key={playlist.id}
        name={playlist.name}
        detail={songCount(playlist.trackCount)}
        paths={playlist.thumbPaths}
        {...playlistPress(playlist, selection)}
      />
    ));
  }
  const withDetail = layout === "grid";
  return (
    <View
      className="flex-row"
      style={{ gap: grid.gutter, height: playlistTileRowHeight(tile, withDetail) }}
    >
      {row.map((playlist) => (
        <PlaylistTile
          key={playlist.id}
          name={playlist.name}
          detail={withDetail ? songCount(playlist.trackCount) : undefined}
          accessibilityDetail={songCount(playlist.trackCount)}
          paths={playlist.thumbPaths}
          size={tile}
          {...playlistPress(playlist, selection)}
        />
      ))}
    </View>
  );
}

/** The cover's side in [layout]: two columns between the margins, or the full width between them. */
const useTileSize = (layout: PlaylistLayout): number => {
  const { width } = useWindowDimensions();
  const across = width - grid.margin * 2;
  return layout === "grid" ? Math.floor((across - grid.gutter) / 2) : Math.floor(across);
};

/** A row's height in [layout] with [tile] covers. */
const rowHeight = (layout: PlaylistLayout, tile: number): number =>
  layout === "list" ? grid.row : playlistTileRowHeight(tile, layout === "grid");

/**
 * The Playlists list (Library › Playlists and the Playlists tab): every
 * playlist by name, in the layout picked from the title's long press, with
 * Import Playlists and New Playlist above them.
 */
export function PlaylistsList({ empty }: { empty: string }) {
  const scrollable = useListScrollable();
  const playlists = usePlaylists();
  const layout = usePlaylistLayout();
  const tile = useTileSize(layout);
  const bottomInset = useChromeInset();
  const list = useRef<LegendListRef>(null);
  useScrollToTop(list);
  const selection = useListSelection({ items: playlists, keyOf, target: playlistsOf });
  const rows = useMemo(() => playlistLayoutRows(playlists, layout), [playlists, layout]);
  const height = rowHeight(layout, tile);
  const rowState = useMemo(() => ({ layout, tile, selection }), [layout, tile, selection]);
  const renderRow = useCallback(
    ({ item }: { item: readonly PlaylistRow[] }) => (
      <PlaylistsRow row={item} layout={layout} tile={tile} selection={selection} />
    ),
    [layout, tile, selection],
  );

  if (playlists.length === 0) {
    return (
      <View style={{ paddingHorizontal: grid.margin }}>
        <EmptyState
          icon={IconPlaylist}
          title="No playlists"
          message={empty}
          action={<PlaylistsActions />}
        />
      </View>
    );
  }

  return (
    <LegendList
      // A new layout lays the list out afresh: its rows change size and shape.
      key={layout}
      ref={list}
      scrollEnabled={scrollable}
      className="flex-1"
      data={rows}
      keyExtractor={rowKey}
      renderItem={renderRow}
      extraData={rowState}
      estimatedItemSize={height}
      getFixedItemSize={() => height}
      recycleItems
      contentContainerStyle={{ paddingHorizontal: grid.margin, paddingBottom: bottomInset }}
      ListHeaderComponent={
        <PlaylistsHeader count={playlists.length}>
          <PlaylistsActions />
        </PlaylistsHeader>
      }
    />
  );
}

/**
 * Library › Playlists' header: how many playlists there are, then [children]
 * (its buttons) on the right. The Design preview draws it too.
 */
export function PlaylistsHeader({ count, children }: { count: number; children: ReactNode }) {
  return (
    <View className="flex-row items-center" style={{ paddingBottom: CELL }}>
      <View className="flex-1">
        <CatalogLine>{counted(count, "playlist")}</CatalogLine>
      </View>
      {children}
    </View>
  );
}

/**
 * Import Playlists (From a Link or From Files; with YT Music off, M3U files
 * at once) and New Playlist, side by side.
 */
function PlaylistsActions() {
  const ytMusic = useYtMusicEnabled();
  return (
    <PlaylistsButtons
      importOpensMenu={ytMusic}
      onImport={openPlaylistImport}
      onNewPlaylist={createAndOpen}
    />
  );
}

/** A button of Library › Playlists' header. */
export type PlaylistsControl = "importPlaylists" | "newPlaylist";

const asItIs = (_: PlaylistsControl, button: ReactNode): ReactNode => button;

/**
 * Import Playlists (opening a card of sources when [importOpensMenu]) and New
 * Playlist, side by side, [wrap] putting each in what it needs (the Design
 * preview opens its states over them). The Design preview draws them too.
 */
export function PlaylistsButtons({
  importOpensMenu,
  onImport,
  onNewPlaylist,
  wrap = asItIs,
}: {
  importOpensMenu: boolean;
  onImport: () => void;
  onNewPlaylist: () => void;
  wrap?: (control: PlaylistsControl, button: ReactNode) => ReactNode;
}) {
  return (
    <View className="flex-row items-center" style={{ gap: CELL * 3 }}>
      {wrap(
        "importPlaylists",
        <TextButton label="Import Playlists" opensMenu={importOpensMenu} onPress={onImport} />,
      )}
      {wrap("newPlaylist", <TextButton label="New Playlist" opensMenu onPress={onNewPlaylist} />)}
    </View>
  );
}
