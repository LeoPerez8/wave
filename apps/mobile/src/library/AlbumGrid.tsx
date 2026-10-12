import { useWindowDimensions, View } from "react-native";

import { type AlbumSummary, AlbumTile } from "@/catalog/AlbumTile";
import { CELL, grid } from "@/catalog/grid";
import { openAlbumActions } from "@/playback/ActionsMenu";
import type { ActionItems } from "@/playback/actionTargets";
import { selectableRow } from "@/selection/selectableRow";
import { useListSelection, type ListSelection } from "@/selection/useListSelection";

import type { AlbumRow } from "./LibraryStore";
import { openAlbum } from "./routes";

/** Fixed height of a tile's caption block (catalog line, two title lines, furniture line). */
const CAPTION = CELL * 12;
/** Space between rows of tiles. */
const ROW_GAP = CELL * 3;

/** Album grids are two columns between the left margin and `rightInset` (margin or spine). */
export const useAlbumTileSize = (rightInset: number): number => {
  const { width } = useWindowDimensions();
  return Math.floor((width - grid.margin - rightInset - grid.gutter) / 2);
};

/** Height of a row of tiles, gap included, so grids lay out by index. */
export const albumRowHeight = (tile: number): number => tile + CAPTION + ROW_GAP;

/** Groups albums two to a row. */
export const albumPairs = (albums: readonly AlbumRow[]): (readonly AlbumRow[])[] => {
  const rows: (readonly AlbumRow[])[] = [];
  for (let i = 0; i < albums.length; i += 2) rows.push(albums.slice(i, i + 2));
  return rows;
};

export const toAlbumSummary = (album: AlbumRow): AlbumSummary => ({
  id: String(album.id),
  title: album.title,
  albumArtist: album.albumArtist,
  year: album.year ?? undefined,
  trackCount: album.trackCount,
  durationMs: album.durationMs,
  artworkUri: album.artworkPath === null ? undefined : `file://${album.artworkPath}`,
});

const albumKey = (album: AlbumRow): string => String(album.id);

/** In selection mode the actions act on the checked albums (their songs, by Core's `groupSongs`). */
const albumsOf = (albums: readonly AlbumRow[]): ActionItems => ({ kind: "album", items: albums });

/** Makes an album grid selectable; [albums] in the order the grid shows them. */
export const useAlbumSelection = (albums: readonly AlbumRow[]): ListSelection<AlbumRow> =>
  useListSelection({ items: albums, keyOf: albumKey, target: albumsOf });

/**
 * One row of a two-column album grid. Tap opens the album; long-press opens its
 * menu. Given the grid's [selection] (`useAlbumSelection`), the menu offers
 * Select, and while selecting every tile shows a check and taps check and
 * uncheck. Put the selection in the list's `extraData` so rows follow it.
 */
export function AlbumPair({
  albums,
  size,
  selection,
}: {
  albums: readonly AlbumRow[];
  size: number;
  selection?: ListSelection<AlbumRow> | undefined;
}) {
  return (
    <View className="flex-row" style={{ gap: grid.gutter, height: albumRowHeight(size) }}>
      {albums.map((album) => (
        <AlbumTile
          key={album.id}
          album={toAlbumSummary(album)}
          size={size}
          {...selectableRow(
            album,
            selection,
            () => openAlbum(album.id, album),
            (options) => openAlbumActions(album, options),
          )}
        />
      ))}
    </View>
  );
}
