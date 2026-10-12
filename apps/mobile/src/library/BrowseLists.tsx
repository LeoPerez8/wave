import { LegendList, type LegendListRef } from "@legendapp/list/react-native";
import { useScrollToTop } from "expo-router";
import { IconStack2 } from "@tabler/icons-react-native";
import { describeFolder } from "@wave/core";
import { useCallback, useMemo, useRef, type ReactElement } from "react";
import { View } from "react-native";

import { AlphabetSpine } from "@/catalog/AlphabetSpine";
import { CatalogLine } from "@/catalog/CatalogLine";
import { CELL, grid } from "@/catalog/grid";
import { NameRow } from "@/catalog/NameRow";
import { useChromeInset } from "@/chrome/chrome";
import { EmptyState } from "@/components/EmptyState";
import { ScanProgressBanner } from "@/components/ScanProgressBanner";
import { openArtistActions, openFolderActions, openGenreActions } from "@/playback/ActionsMenu";
import type { ActionItems } from "@/playback/itemActions";
import { useListSelection, type ListSelection } from "@/selection/useListSelection";

import {
  albumPairs,
  albumRowHeight,
  AlbumPair,
  useAlbumSelection,
  useAlbumTileSize,
} from "./AlbumGrid";
import { useAlbums, useArtists, useFolders, useGenres, useScanState } from "./hooks";
import type { AlbumRow, ArtistRow, FolderRow, GenreRow } from "./LibraryStore";
import { openArtist, openFolder, openGenre } from "./routes";
import { useSpine } from "./useSpine";
import { useListScrollable } from "@/motion/heldTouch";

const counted = (count: number, word: string): string =>
  `${count.toLocaleString("en")} ${count === 1 ? word : `${word}s`}`;

function ListHead({ line }: { line: string }) {
  return (
    <View style={{ paddingBottom: CELL }}>
      <ScanProgressBanner />
      <CatalogLine>{line}</CatalogLine>
    </View>
  );
}

/** Shown while a list has nothing: the scan may still be finding it. */
function NothingYet({ message }: { message: string }) {
  const scan = useScanState();
  return (
    <View style={{ paddingHorizontal: grid.margin }}>
      <ScanProgressBanner />
      <EmptyState
        icon={IconStack2}
        title={scan.status === "scanning" ? "Looking for music" : "Nothing here yet"}
        message={message}
      />
    </View>
  );
}

type NameListProps<A> = {
  items: readonly A[];
  noun: string;
  empty: string;
  sortKey: (item: A) => string;
  keyOf: (item: A) => string;
  /** What the selection bar acts on: the checked items, in list order. */
  target: (selected: readonly A[]) => ActionItems;
  /** A row; [selection] tells it whether the list is selecting and what's checked. */
  renderRow: (item: A, selection: ListSelection<A>) => ReactElement;
};

/** While selecting, a long-press does nothing (rather than toggling the row on release). */
const ignoreLongPress = (): void => undefined;

/**
 * How a row in a selectable list behaves: tap opens it and long-press opens its
 * menu (with Select); while selecting, it shows a check and taps toggle it.
 */
const selectableRow = <A,>(
  item: A,
  selection: ListSelection<A>,
  open: () => void,
  openMenu: (options: { onSelect: () => void }) => void,
) =>
  selection.selecting
    ? {
        checked: selection.isChecked(item),
        onPress: () => selection.toggle(item),
        onLongPress: ignoreLongPress,
      }
    : {
        checked: undefined,
        onPress: open,
        onLongPress: () => openMenu({ onSelect: () => selection.start(item) }),
      };

/** A virtualised, selectable list of names (artists, genres, folders) with the A–Z spine. */
function NameList<A>({ items, noun, empty, sortKey, keyOf, target, renderRow }: NameListProps<A>) {
  const scrollable = useListScrollable();
  const list = useRef<LegendListRef>(null);
  useScrollToTop(list);
  const bottomInset = useChromeInset();
  const sortKeys = useMemo(() => items.map(sortKey), [items, sortKey]);
  const spine = useSpine(sortKeys, list);
  const selection = useListSelection({ items, keyOf, target });
  const renderItem = useCallback(
    ({ item }: { item: A }) => renderRow(item, selection),
    [renderRow, selection],
  );

  if (items.length === 0) return <NothingYet message={empty} />;
  return (
    <View className="flex-1">
      <LegendList
        scrollEnabled={scrollable}
        ref={list}
        className="flex-1"
        data={items}
        keyExtractor={keyOf}
        renderItem={renderItem}
        extraData={selection}
        estimatedItemSize={grid.row}
        getFixedItemSize={() => grid.row}
        recycleItems
        contentContainerStyle={{
          paddingLeft: grid.margin,
          paddingRight: spine.paddingRight,
          paddingBottom: bottomInset,
        }}
        ListHeaderComponent={<ListHead line={counted(items.length, noun)} />}
      />
      {spine.show && <AlphabetSpine letters={spine.letters} onLetter={spine.onLetter} />}
    </View>
  );
}

const artistSort = (artist: ArtistRow) => artist.sort;
const artistKey = (artist: ArtistRow) => String(artist.id);
const artistDetail = (artist: ArtistRow): string =>
  artist.albumCount > 0
    ? `${counted(artist.albumCount, "album")} · ${counted(artist.trackCount, "song")}`
    : counted(artist.trackCount, "song");
const artistsOf = (artists: readonly ArtistRow[]): ActionItems => ({
  kind: "artist",
  items: artists,
});
const renderArtist = (artist: ArtistRow, selection: ListSelection<ArtistRow>) => (
  <NameRow
    name={artist.name}
    artist={artist}
    detail={artistDetail(artist)}
    {...selectableRow(
      artist,
      selection,
      () => openArtist(artist.id),
      (options) => openArtistActions(artist, options),
    )}
  />
);

/** Library › Artists: track and album artists, sorted ignoring The/A/An and accents. */
export function ArtistsList({ empty }: { empty: string }) {
  return (
    <NameList
      items={useArtists()}
      noun="artist"
      empty={empty}
      sortKey={artistSort}
      keyOf={artistKey}
      target={artistsOf}
      renderRow={renderArtist}
    />
  );
}

const genreSort = (genre: GenreRow) => genre.sort;
const genreKey = (genre: GenreRow) => String(genre.id);
const genresOf = (genres: readonly GenreRow[]): ActionItems => ({ kind: "genre", items: genres });
const renderGenre = (genre: GenreRow, selection: ListSelection<GenreRow>) => (
  <NameRow
    name={genre.name}
    detail={counted(genre.trackCount, "song")}
    {...selectableRow(
      genre,
      selection,
      () => openGenre(genre.id),
      (options) => openGenreActions(genre, options),
    )}
  />
);

export function GenresList({ empty }: { empty: string }) {
  return (
    <NameList
      items={useGenres()}
      noun="genre"
      empty={empty}
      sortKey={genreSort}
      keyOf={genreKey}
      target={genresOf}
      renderRow={renderGenre}
    />
  );
}

/** Where a folder sits, from the storage root: `Music/Rock` for `…/0/Music/Rock/Album`. */
export const folderParent = (path: string): string => {
  const { relativePath, storage } = describeFolder(path);
  const slash = relativePath.lastIndexOf("/");
  return slash > 0 ? relativePath.slice(0, slash) : (storage ?? "");
};

const folderSort = (folder: FolderRow) => folder.sort;
const folderKey = (folder: FolderRow) => String(folder.id);
const foldersOf = (folders: readonly FolderRow[]): ActionItems => ({
  kind: "folder",
  items: folders,
});
const renderFolder = (folder: FolderRow, selection: ListSelection<FolderRow>) => {
  const parent = folderParent(folder.path);
  const count = counted(folder.trackCount, "song");
  return (
    <NameRow
      name={folder.name}
      detail={parent === "" ? count : `${count} · ${parent}`}
      {...selectableRow(
        folder,
        selection,
        () => openFolder(folder.id),
        (options) => openFolderActions(folder, options),
      )}
    />
  );
};

/** Library › Folders: every folder that holds songs, by name. */
export function FoldersList({ empty }: { empty: string }) {
  return (
    <NameList
      items={useFolders()}
      noun="folder"
      empty={empty}
      sortKey={folderSort}
      keyOf={folderKey}
      target={foldersOf}
      renderRow={renderFolder}
    />
  );
}

const pairKey = (pair: readonly AlbumRow[]): string => pair.map((album) => album.id).join("-");
const pairRow = (index: number): number => Math.floor(index / 2);

/** Library › Albums: a two-column artwork grid by title, with the A–Z spine. */
export function AlbumsList({ empty }: { empty: string }) {
  const scrollable = useListScrollable();
  const albums = useAlbums();
  const list = useRef<LegendListRef>(null);
  useScrollToTop(list);
  const bottomInset = useChromeInset();
  const sortKeys = useMemo(() => albums.map((album) => album.titleSort), [albums]);
  const spine = useSpine(sortKeys, list, pairRow);
  const tile = useAlbumTileSize(spine.paddingRight);
  const rows = useMemo(() => albumPairs(albums), [albums]);
  const selection = useAlbumSelection(albums);
  const rowState = useMemo(() => ({ tile, selection }), [tile, selection]);
  const renderItem = useCallback(
    ({ item }: { item: readonly AlbumRow[] }) => (
      <AlbumPair albums={item} size={tile} selection={selection} />
    ),
    [tile, selection],
  );

  if (albums.length === 0) return <NothingYet message={empty} />;
  return (
    <View className="flex-1">
      <LegendList
        scrollEnabled={scrollable}
        ref={list}
        className="flex-1"
        data={rows}
        keyExtractor={pairKey}
        renderItem={renderItem}
        extraData={rowState}
        estimatedItemSize={albumRowHeight(tile)}
        getFixedItemSize={() => albumRowHeight(tile)}
        recycleItems
        contentContainerStyle={{
          paddingLeft: grid.margin,
          paddingRight: spine.paddingRight,
          paddingBottom: bottomInset,
        }}
        ListHeaderComponent={<ListHead line={counted(albums.length, "album")} />}
      />
      {spine.show && <AlphabetSpine letters={spine.letters} onLetter={spine.onLetter} />}
    </View>
  );
}
