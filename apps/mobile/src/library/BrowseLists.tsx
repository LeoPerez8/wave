import { useScreenContent } from "@/lib/screenTiming";
import { libraryQueryHasContent } from "./sharedQueries";
import { LibraryReadFeedback } from "./LibraryReadFeedback";
import { LegendList, type LegendListRef } from "@legendapp/list/react-native";
import { useScrollToTop } from "expo-router";
import { IconStack2 } from "@tabler/icons-react-native";
import { artistFindText, counted, type PlaylistFindText } from "@wave/core";
import { useCallback, useMemo, useRef, type ReactElement } from "react";
import { useWindowDimensions, View } from "react-native";

import { AlphabetSpine } from "@/catalog/AlphabetSpine";
import { ArtistCardRow } from "@/catalog/cards/ArtistCard";
import { CatalogLine } from "@/catalog/CatalogLine";
import { CELL, grid } from "@/catalog/grid";
import { NameRow } from "@/catalog/NameRow";
import { useChromeInset } from "@/chrome/chrome";
import { EmptyState } from "@/components/EmptyState";
import { ScanProgressBanner } from "@/components/ScanProgressBanner";
import { openArtistActions, openGenreActions } from "@/playback/ActionsMenu";
import type { ActionItems } from "@/playback/actionTargets";
import { selectableRow } from "@/selection/selectableRow";
import { useListSelection, type ListSelection } from "@/selection/useListSelection";

import {
  albumCardRowHeight,
  albumPairs,
  AlbumPair,
  useAlbumSelection,
  useAlbumTileSize,
} from "./AlbumGrid";
import { FIND_FIELD_HEIGHT, FindHead, useFindInLegendList } from "./FindInPlaylist";
import { useAlbums, useArtists, useGenres, useScanState } from "./hooks";
import type { AlbumRow, ArtistRow, GenreRow } from "./LibraryStore";
import { openArtist, openGenre } from "./routes";
import { useSpine } from "./useSpine";
import { useListScrollable } from "@/motion/heldTouch";

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
  /**
   * Find in Artists: what finds each item. Its field waits above the head
   * until the list is pulled down, and narrows the list as you type.
   */
  findBy?: (item: A) => PlaylistFindText | null;
};

const unfindable = (): null => null;

/** A virtualised, selectable list of names (artists, genres) with the A–Z spine. */
function NameList<A>({
  items,
  noun,
  empty,
  sortKey,
  keyOf,
  target,
  renderRow,
  findBy,
}: NameListProps<A>) {
  const scrollable = useListScrollable();
  const list = useRef<LegendListRef>(null);
  useScrollToTop(list);
  const bottomInset = useChromeInset();
  const sortKeys = useMemo(() => items.map(sortKey), [items, sortKey]);
  const spine = useSpine(sortKeys, list);
  const selection = useListSelection({ items, keyOf, target });
  const findable = findBy !== undefined;
  const find = useFindInLegendList(list, items, findBy ?? unfindable, findable);
  const renderItem = useCallback(
    ({ item }: { item: A }) => renderRow(item, selection),
    [renderRow, selection],
  );

  if (items.length === 0) return <NothingYet message={empty} />;
  const head = <ListHead line={counted(items.length, noun)} />;
  return (
    <View className="flex-1">
      <LegendList
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        scrollEnabled={scrollable}
        ref={list}
        className="flex-1"
        data={find.shown}
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
          minHeight: findable ? find.minHeight : undefined,
        }}
        initialScrollOffset={findable ? FIND_FIELD_HEIGHT : undefined}
        ListHeaderComponent={findable ? <FindHead find={find} header={head} of="artists" /> : head}
      />
      {spine.show && find.found === null && (
        <AlphabetSpine entries={spine.entries} onJump={spine.onJump} topRow={spine.topRow} />
      )}
    </View>
  );
}

const artistSort = (artist: ArtistRow) => artist.sort;
const artistKey = (artist: ArtistRow) => String(artist.id);
const artistFind = (artist: ArtistRow): PlaylistFindText => artistFindText(artist.name);
const artistsOf = (artists: readonly ArtistRow[]): ActionItems => ({
  kind: "artist",
  items: artists,
});
const renderArtist = (artist: ArtistRow, selection: ListSelection<ArtistRow>) => (
  <ArtistCardRow
    name={artist.name}
    artist={artist}
    {...selectableRow(
      artist,
      selection,
      () => openArtist(artist.id, artist),
      (options) => openArtistActions(artist, options),
    )}
  />
);

/** Library › Artists: track and album artists, sorted ignoring The/A/An and accents. */
export function ArtistsList({ empty }: { empty: string }) {
  const artists = useArtists();
  useScreenContent(libraryQueryHasContent("artists"));
  if (!libraryQueryHasContent("artists"))
    return <LibraryReadFeedback queryKey="artists" label="artists" shape="artists" scan />;
  return (
    <NameList
      items={artists}
      noun="artist"
      empty={empty}
      sortKey={artistSort}
      keyOf={artistKey}
      target={artistsOf}
      renderRow={renderArtist}
      findBy={artistFind}
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
      () => openGenre(genre.id, genre),
      (options) => openGenreActions(genre, options),
    )}
  />
);

export function GenresList({ empty }: { empty: string }) {
  const genres = useGenres();
  useScreenContent(libraryQueryHasContent("genres"));
  if (!libraryQueryHasContent("genres"))
    return <LibraryReadFeedback queryKey="genres" label="genres" shape="genres" scan />;
  return (
    <NameList
      items={genres}
      noun="genre"
      empty={empty}
      sortKey={genreSort}
      keyOf={genreKey}
      target={genresOf}
      renderRow={renderGenre}
    />
  );
}

const pairKey = (pair: readonly AlbumRow[]): string => pair.map((album) => album.id).join("-");
const pairRow = (index: number): number => Math.floor(index / 2);

/** Library › Albums: a two-column artwork grid by title, with the A–Z spine. */
export function AlbumsList({ empty }: { empty: string }) {
  const scrollable = useListScrollable();
  const albums = useAlbums();
  useScreenContent(libraryQueryHasContent("albums"));
  const list = useRef<LegendListRef>(null);
  useScrollToTop(list);
  const bottomInset = useChromeInset();
  const sortKeys = useMemo(() => albums.map((album) => album.titleSort), [albums]);
  const spine = useSpine(sortKeys, list, pairRow);
  const tile = useAlbumTileSize(spine.paddingRight);
  const { fontScale } = useWindowDimensions();
  const rowHeight = albumCardRowHeight(tile, fontScale);
  const rows = useMemo(() => albumPairs(albums), [albums]);
  const selection = useAlbumSelection(albums);
  const rowState = useMemo(() => ({ tile, selection }), [tile, selection]);
  const renderItem = useCallback(
    ({ item }: { item: readonly AlbumRow[] }) => (
      <AlbumPair albums={item} size={tile} selection={selection} />
    ),
    [tile, selection],
  );

  if (!libraryQueryHasContent("albums"))
    return <LibraryReadFeedback queryKey="albums" label="albums" shape="albums" scan />;
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
        estimatedItemSize={rowHeight}
        getFixedItemSize={() => rowHeight}
        recycleItems
        contentContainerStyle={{
          paddingLeft: grid.margin,
          paddingRight: spine.paddingRight,
          paddingBottom: bottomInset,
        }}
        ListHeaderComponent={<ListHead line={counted(albums.length, "album")} />}
      />
      {spine.show && (
        <AlphabetSpine entries={spine.entries} onJump={spine.onJump} topRow={spine.topRow} />
      )}
    </View>
  );
}
