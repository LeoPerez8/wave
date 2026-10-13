import { LegendList, type LegendListRef } from "@legendapp/list/react-native";
import { IconPlaylist } from "@tabler/icons-react-native";
import { useScrollToTop } from "expo-router";
import { useCallback, useRef } from "react";
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
import type { PlaylistRow } from "./LibraryStore";
import { emptyPlaylistRow } from "./playlists";
import { newPlaylist } from "./PlaylistSheets";
import { openPlaylist } from "./routes";
import { songCount } from "./TrackList";
import { useListScrollable } from "@/motion/heldTouch";

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

/** Library › Playlists: every playlist by name, with New Playlist above them. */
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
          action={<TextButton label="New Playlist" opensMenu onPress={createAndOpen} />}
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
        <View className="flex-row items-center" style={{ paddingBottom: CELL }}>
          <View className="flex-1">
            <CatalogLine>
              {`${playlists.length} ${playlists.length === 1 ? "playlist" : "playlists"}`}
            </CatalogLine>
          </View>
          <TextButton label="New Playlist" opensMenu onPress={createAndOpen} />
        </View>
      }
    />
  );
}
