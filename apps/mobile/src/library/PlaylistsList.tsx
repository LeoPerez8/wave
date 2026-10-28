import { useScreenContent } from "@/lib/screenTiming";
import { libraryQueryHasContent } from "./sharedQueries";
import { IconPlaylist } from "@tabler/icons-react-native";
import { counted, importProgressLine, type PlaylistLayout } from "@wave/core";
import { useCallback, useMemo, type ReactNode } from "react";
import { useWindowDimensions, View, type AccessibilityActionEvent } from "react-native";

import { PlaylistCard, PlaylistCardRow } from "@/catalog/cards/PlaylistCard";
import { CatalogLine } from "@/catalog/CatalogLine";
import { CELL, grid } from "@/catalog/grid";
import { playlistCardRowHeight } from "@/catalog/playlistTileSize";
import { EmptyState } from "@/components/EmptyState";
import { TextButton } from "@/components/TextButton";
import { openPlaylistActions } from "@/playback/ActionsMenu";
import type { ActionItems } from "@/playback/actionTargets";
import { selectableRow } from "@/selection/selectableRow";
import { useListSelection, type ListSelection } from "@/selection/useListSelection";

import { LibraryReadFeedback } from "./LibraryReadFeedback";
import { ArrangeablePlaylists, TILE_GRIP_INSET } from "./ArrangeablePlaylists";
import { ImportBatchLine } from "./ImportBatchLine";
import { openPlaylistImport } from "./importPlaylistLink";
import { useImportProgress } from "./importProgress";
import type { PlaylistRow } from "./LibraryStore";
import { usePlaylistLayout } from "./playlistLayout";
import { moveShownPlaylist } from "./playlistOrder";
import { emptyPlaylistRow } from "./playlists";
import { newPlaylist } from "./PlaylistSheets";
import { useSortedPlaylists } from "./playlistSort";
import { openPlaylist } from "./routes";
import { songCount } from "./TrackList";
import { useRenderCount } from "@/perf/perf";
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
 * Move up and Move down for screen readers, on the playlist at [index] of
 * [ids] (the list's order on screen): they arrange the list by hand, so under
 * another sort they switch it to Custom from the order shown. None unless
 * [arrangeable] (not while selecting, nor while Find narrows the list).
 */
const moveActions = (index: number, ids: readonly number[], arrangeable: boolean) => {
  if (!arrangeable) return {};
  return {
    accessibilityActions: [
      ...(index > 0 ? [{ name: "moveUp", label: "Move up" }] : []),
      ...(index < ids.length - 1 ? [{ name: "moveDown", label: "Move down" }] : []),
    ],
    onAccessibilityAction: (event: AccessibilityActionEvent) => {
      const action = event.nativeEvent.actionName;
      if (action === "moveUp") moveShownPlaylist(ids, index, index - 1);
      else if (action === "moveDown") moveShownPlaylist(ids, index, index + 1);
    },
  };
};

/**
 * One playlist as [layout] shows it: a row with a small mosaic (list), a tile
 * with its count (grid), or a full-width card (large), a tile's name leaving
 * room for the drag handle over its end. While selecting, it shows a check.
 */
function PlaylistView({
  playlist,
  index,
  ids,
  layout,
  tile,
  selection,
  arrangeable,
}: {
  playlist: PlaylistRow;
  /** Its place in the list: an index of [ids], the order on screen. */
  index: number;
  ids: readonly number[];
  /** Whether it can be moved: not while selecting, nor while Find narrows the list. */
  arrangeable: boolean;
  layout: PlaylistLayout;
  /** The cover's side for this layout's tiles. */
  tile: number;
  selection: ListSelection<PlaylistRow>;
}) {
  const press = playlistPress(playlist, selection);
  const moves = moveActions(index, ids, arrangeable);
  // An importing playlist says what its import is doing instead of its count (Core's `importProgressLine`).
  const progress = useImportProgress(playlist.id);
  const detail = progress === null ? songCount(playlist.trackCount) : importProgressLine(progress);
  if (layout === "list") {
    return (
      <PlaylistCardRow
        name={playlist.name}
        detail={detail}
        paths={playlist.thumbPaths}
        {...press}
        {...moves}
      />
    );
  }
  return (
    <PlaylistCard
      name={playlist.name}
      detail={detail}
      paths={playlist.thumbPaths}
      size={tile}
      nameInset={TILE_GRIP_INSET}
      {...press}
      {...moves}
    />
  );
}

/** The cover's side in [layout]: two columns between the margins, or the full width between them. */
const useTileSize = (layout: PlaylistLayout): number => {
  const { width } = useWindowDimensions();
  const across = width - grid.margin * 2;
  return layout === "grid" ? Math.floor((across - grid.gutter) / 2) : Math.floor(across);
};

/** A row's height in [layout] with [tile] covers, at the font scale. */
const rowHeight = (layout: PlaylistLayout, tile: number, fontScale: number): number =>
  layout === "list" ? grid.row : playlistCardRowHeight(tile, fontScale);

/**
 * The Playlists list (Library › Playlists and the Playlists tab): every
 * playlist in the order picked under Sort by, in the layout picked from the
 * title's long press, with Import Playlists and New Playlist above them
 * whatever the order. Each playlist's handle drags it to a new place, which
 * under another sort switches the list to Custom from the order on screen.
 * Find in Playlists, above them all, narrows the list by name (see
 * `ArrangeablePlaylists`). While a batch of playlists imports, its line
 * ("Importing playlists · 12 of 80") sits under the field, whatever the query.
 */
export function PlaylistsList({ empty }: { empty: string }) {
  useRenderCount("PlaylistsList");
  const playlists = useSortedPlaylists();
  useScreenContent(libraryQueryHasContent("playlists"));
  const layout = usePlaylistLayout();
  const tile = useTileSize(layout);
  const { fontScale } = useWindowDimensions();
  const selection = useListSelection({ items: playlists, keyOf, target: playlistsOf });
  const ids = useMemo(() => playlists.map((playlist) => playlist.id), [playlists]);
  const renderPlaylist = useCallback(
    (playlist: PlaylistRow, index: number, arrangeable: boolean) => (
      <PlaylistView
        playlist={playlist}
        index={index}
        ids={ids}
        layout={layout}
        tile={tile}
        selection={selection}
        arrangeable={arrangeable}
      />
    ),
    [ids, layout, tile, selection],
  );

  if (playlists.length === 0 && !libraryQueryHasContent("playlists"))
    return <LibraryReadFeedback queryKey="playlists" label="playlists" />;

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
    <ArrangeablePlaylists
      // A new layout lays the list out afresh: its cells change size and shape.
      key={layout}
      playlists={playlists}
      layout={layout}
      tile={tile}
      rowHeight={rowHeight(layout, tile, fontScale)}
      selecting={selection.selecting}
      header={
        <PlaylistsHeader count={playlists.length}>
          <PlaylistsActions />
        </PlaylistsHeader>
      }
      lead={<ImportBatchLine />}
      renderPlaylist={renderPlaylist}
    />
  );
}

/**
 * Library › Playlists' header: how many playlists there are, then [children]
 * (its buttons) on the right. The Design preview draws it too.
 */
export function PlaylistsHeader({ count, children }: { count: number; children: ReactNode }) {
  return (
    <View
      className="flex-row flex-wrap items-center"
      style={{ paddingBottom: CELL, columnGap: CELL * 3 }}
    >
      <View style={{ flexGrow: 1 }}>
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
    <View
      className="flex-row flex-wrap items-center"
      style={{ columnGap: CELL * 3, flexShrink: 1, maxWidth: "100%" }}
    >
      {wrap(
        "importPlaylists",
        <TextButton label="Import Playlists" opensMenu={importOpensMenu} onPress={onImport} />,
      )}
      {wrap("newPlaylist", <TextButton label="New Playlist" opensMenu onPress={onNewPlaylist} />)}
    </View>
  );
}
