import { useScreenContent } from "@/lib/screenTiming";
import { useLocalisation } from "@/localisation/localisation";
import { libraryQueryHasContent } from "./sharedQueries";
import { LibraryReadFeedback } from "./LibraryReadFeedback";
import { LegendList, type LegendListRef } from "@legendapp/list/react-native";
import { useScrollToTop } from "expo-router";
import { IconStack2 } from "@tabler/icons-react-native";
import {
  albumFindText,
  artistFindText,
  genreFindText,
  type FindableListKind,
  type PlaylistFindText,
} from "@wave/core";
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
import { selectableRow, type SelectableRowProps } from "@/selection/selectableRow";
import { useListSelection, type ListSelection } from "@/selection/useListSelection";

import {
  albumCardRowHeight,
  albumPairs,
  AlbumPair,
  useAlbumSelection,
  useAlbumTileSize,
} from "./AlbumGrid";
import { FindFrame, FindHead, useFindInLegendList } from "./FindInPlaylist";
import { useAlbums, useArtists, useGenres, useScanStatus } from "./hooks";
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
  const scanStatus = useScanStatus();
  const { strings } = useLocalisation();
  return (
    <View style={{ paddingHorizontal: grid.margin }}>
      <ScanProgressBanner />
      <EmptyState
        icon={IconStack2}
        title={
          scanStatus === "scanning" ? strings.library.lookingForMusic : strings.library.nothingHereYet
        }
        message={message}
      />
    </View>
  );
}

type NameListProps<A> = {
  items: readonly A[];
  noun: "artist" | "genre";
  empty: string;
  sortKey: (item: A) => string;
  keyOf: (item: A) => string;
  /** What the selection bar acts on: the checked items, in list order. */
  target: (selected: readonly A[]) => ActionItems;
  /** A row; [selection] tells it whether the list is selecting and what's checked. */
  renderRow: (item: A, selection: ListSelection<A>) => ReactElement;
  /**
   * Find in Artists or Genres ([of]): what finds each item ([by]). Its field
   * waits above the head until the list is pulled down, and narrows the list
   * as you type.
   */
  findIn?: { readonly of: FindableListKind; readonly by: (item: A) => PlaylistFindText | null };
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
  findIn,
}: NameListProps<A>) {
  const scrollable = useListScrollable();
  const { strings } = useLocalisation();
  const list = useRef<LegendListRef>(null);
  useScrollToTop(list);
  const bottomInset = useChromeInset();
  const sortKeys = useMemo(() => items.map(sortKey), [items, sortKey]);
  const spine = useSpine(sortKeys, list);
  const selection = useListSelection({ items, keyOf, target });
  const findable = findIn !== undefined;
  const find = useFindInLegendList(list, items, findIn?.by ?? unfindable, findable);
  const renderItem = useCallback(
    ({ item }: { item: A }) => renderRow(item, selection),
    [renderRow, selection],
  );

  if (items.length === 0) return <NothingYet message={empty} />;
  const head = <ListHead line={strings.library.kindCounts[noun](items.length)} />;
  return (
    <FindFrame find={find} of={findIn?.of} inset={spine.paddingRight}>
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
        initialScrollOffset={findable ? find.initialOffset : undefined}
        ListHeaderComponent={
          findIn === undefined ? head : <FindHead find={find} header={head} of={findIn.of} />
        }
      />
      {spine.show && find.found === null && (
        <AlphabetSpine entries={spine.entries} onJump={spine.onJump} topRow={spine.topRow} />
      )}
    </FindFrame>
  );
}

const artistSort = (artist: ArtistRow) => artist.sort;
const artistKey = (artist: ArtistRow) => String(artist.id);
const findArtists = {
  of: "artists",
  by: (artist: ArtistRow): PlaylistFindText => artistFindText(artist.name),
} as const;
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
    return <LibraryReadFeedback queryKey="artists" list="artists" shape="artists" scan />;
  return (
    <NameList
      items={artists}
      noun="artist"
      empty={empty}
      sortKey={artistSort}
      keyOf={artistKey}
      target={artistsOf}
      renderRow={renderArtist}
      findIn={findArtists}
    />
  );
}

const genreSort = (genre: GenreRow) => genre.sort;
const genreKey = (genre: GenreRow) => String(genre.id);
const findGenres = {
  of: "genres",
  by: (genre: GenreRow): PlaylistFindText => genreFindText(genre.name),
} as const;
const genresOf = (genres: readonly GenreRow[]): ActionItems => ({ kind: "genre", items: genres });
/** A genre's row, its song count in the language Wave reads in. */
function GenreNameRow({ genre, ...press }: { genre: GenreRow } & SelectableRowProps) {
  const { strings } = useLocalisation();
  return (
    <NameRow name={genre.name} detail={strings.library.songCount(genre.trackCount)} {...press} />
  );
}

const renderGenre = (genre: GenreRow, selection: ListSelection<GenreRow>) => (
  <GenreNameRow
    genre={genre}
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
    return <LibraryReadFeedback queryKey="genres" list="genres" shape="genres" scan />;
  return (
    <NameList
      items={genres}
      noun="genre"
      empty={empty}
      sortKey={genreSort}
      keyOf={genreKey}
      target={genresOf}
      renderRow={renderGenre}
      findIn={findGenres}
    />
  );
}

const findAlbum = (album: AlbumRow): PlaylistFindText =>
  albumFindText(album.title, album.albumArtist);
const pairKey = (pair: readonly AlbumRow[]): string => pair.map((album) => album.id).join("-");
const pairRow = (index: number): number => Math.floor(index / 2);

/**
 * Library › Albums: a two-column artwork grid by title, with the A–Z spine.
 * Find in Albums waits above the head until the grid is pulled down, and
 * narrows it by title and album artist as you type.
 */
export function AlbumsList({ empty }: { empty: string }) {
  const scrollable = useListScrollable();
  const { strings } = useLocalisation();
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
  const find = useFindInLegendList(list, albums, findAlbum, true);
  const rows = useMemo(() => albumPairs(find.shown), [find.shown]);
  const selection = useAlbumSelection(albums);
  const rowState = useMemo(() => ({ tile, selection }), [tile, selection]);
  const renderItem = useCallback(
    ({ item }: { item: readonly AlbumRow[] }) => (
      <AlbumPair albums={item} size={tile} selection={selection} />
    ),
    [tile, selection],
  );

  if (!libraryQueryHasContent("albums"))
    return <LibraryReadFeedback queryKey="albums" list="albums" shape="albums" scan />;
  if (albums.length === 0) return <NothingYet message={empty} />;
  const head = <ListHead line={strings.library.albumCount(albums.length)} />;
  return (
    <FindFrame find={find} of="albums" inset={spine.paddingRight}>
      <LegendList
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
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
          minHeight: find.minHeight,
        }}
        initialScrollOffset={find.initialOffset}
        ListHeaderComponent={<FindHead find={find} header={head} of="albums" />}
      />
      {spine.show && find.found === null && (
        <AlphabetSpine entries={spine.entries} onJump={spine.onJump} topRow={spine.topRow} />
      )}
    </FindFrame>
  );
}
