import { LegendList, type LegendListRef } from "@legendapp/list/react-native";
import { IconPlaylist } from "@tabler/icons-react-native";
import { counted } from "@wave/core";
import { useScrollToTop } from "expo-router";
import { useCallback, useRef, type ReactNode } from "react";
import { View } from "react-native";

import { CatalogLine } from "@/catalog/CatalogLine";
import { CELL, grid } from "@/catalog/grid";
import { PlaylistEntry } from "@/catalog/PlaylistEntry";
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

/**
 * A playlist row. Tap opens it; long-press opens its menu, which offers
 * Select. While selecting, rows show a check and taps check and uncheck.
 */
function PlaylistItem({
  playlist,
  selection,
}: {
  playlist: PlaylistRow;
  selection: ListSelection<PlaylistRow>;
}) {
  return (
    <PlaylistEntry
      name={playlist.name}
      detail={songCount(playlist.trackCount)}
      paths={playlist.thumbPaths}
      {...selectableRow(
        playlist,
        selection,
        () => openPlaylist(playlist.id, playlist),
        (options) => openPlaylistActions(playlist, options),
      )}
    />
  );
}

/** Library › Playlists: every playlist by name, with Import Playlists and New Playlist above them. */
export function PlaylistsList({ empty }: { empty: string }) {
  const scrollable = useListScrollable();
  const playlists = usePlaylists();
  const bottomInset = useChromeInset();
  const list = useRef<LegendListRef>(null);
  useScrollToTop(list);
  const selection = useListSelection({ items: playlists, keyOf, target: playlistsOf });
  const renderPlaylist = useCallback(
    ({ item }: { item: PlaylistRow }) => <PlaylistItem playlist={item} selection={selection} />,
    [selection],
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
      ref={list}
      scrollEnabled={scrollable}
      className="flex-1"
      data={playlists}
      keyExtractor={keyOf}
      renderItem={renderPlaylist}
      extraData={selection}
      estimatedItemSize={grid.row}
      getFixedItemSize={() => grid.row}
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
