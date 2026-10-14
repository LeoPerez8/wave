import { LegendList } from "@legendapp/list/react-native";
import { useLocalSearchParams } from "expo-router";
import { useCallback, useMemo } from "react";
import { Text, useWindowDimensions, View } from "react-native";

import { ArtistImage } from "@/catalog/ArtistImage";
import { CatalogLine } from "@/catalog/CatalogLine";
import { CELL, grid } from "@/catalog/grid";
import { TrackRow } from "@/catalog/TrackRow";
import { useChromeInset } from "@/chrome/chrome";
import { playSongs } from "@/playback/actions";
import { useCurrentTrackId } from "@/playback/hooks";
import { openTrackActions } from "@/playback/ActionsMenu";
import { mixedTarget, type MixedItem } from "@/playback/actionTargets";
import { albumPairs, albumRowHeight, AlbumPair, useAlbumTileSize } from "@/library/AlbumGrid";
import { DetailFrame } from "@/library/DetailFrame";
import { useFavoriteIds } from "@/library/favorites";
import { useArtist } from "@/library/hooks";
import type { AlbumRow, ArtistDetail, ArtistRow, SongRow } from "@/library/LibraryStore";
import { parseId, useKnownRow } from "@/library/routes";
import { SongSortButton } from "@/library/SongSortButton";
import { useSortedSongs } from "@/library/songSort";
import { ListIntro, songCount, toTrackSummary } from "@/library/TrackList";
import { useListScrollable } from "@/motion/heldTouch";
import { selectableRow } from "@/selection/selectableRow";
import { useListSelection, type ListSelection } from "@/selection/useListSelection";
import { ArtistStatsBlock } from "@/stats/ArtistStatsBlock";
import { YtArtistSection } from "@/ytmusic/YtArtistSection";

type Item =
  | { readonly type: "section"; readonly label: string }
  | { readonly type: "albums"; readonly albums: readonly AlbumRow[] }
  | { readonly type: "track"; readonly song: SongRow; readonly index: number };

const SECTION_HEAD = CELL * 6;

const artistItems = (detail: ArtistDetail, songs: readonly SongRow[]): Item[] => {
  const items: Item[] = [];
  const shelf = (label: string, albums: readonly AlbumRow[]) => {
    if (albums.length === 0) return;
    items.push({ type: "section", label });
    for (const pair of albumPairs(albums)) items.push({ type: "albums", albums: pair });
  };
  shelf("Albums", detail.albums);
  shelf("Appears on", detail.appearsOn);
  if (songs.length > 0) items.push({ type: "section", label: "Songs" });
  songs.forEach((song, index) => items.push({ type: "track", song, index }));
  return items;
};

const itemKey = (item: Item): string => {
  switch (item.type) {
    case "section":
      return `section-${item.label}`;
    case "albums":
      return `albums-${item.albums.map((album) => album.id).join("-")}`;
    case "track":
      return `track-${item.song.id}`;
  }
};

const albumItem = (album: AlbumRow): MixedItem => ({ kind: "album", item: album });
const trackItem = (song: SongRow): MixedItem => ({ kind: "track", item: { song } });

/**
 * What can be checked on the page, in page order: the albums (their shelf,
 * then Appears on), then the songs. Albums and songs check together.
 */
const selectableItems = (detail: ArtistDetail, songs: readonly SongRow[]): MixedItem[] => [
  ...detail.albums.map(albumItem),
  ...detail.appearsOn.map(albumItem),
  ...songs.map(trackItem),
];

const selectableKey = (mixed: MixedItem): string =>
  mixed.kind === "album" ? `album-${mixed.item.id}` : `track-${mixed.item.song.id}`;

/** The page's selection as the album tiles see it. */
const albumSelectionOf = (page: ListSelection<MixedItem>): ListSelection<AlbumRow> => ({
  selecting: page.selecting,
  selection: page.selection,
  isChecked: (album) => page.isChecked(albumItem(album)),
  start: (album) => page.start(albumItem(album)),
  toggle: (album) => page.toggle(albumItem(album)),
});

/** The artist page's head: their image as a large circle, then their name. */
function ArtistHead({ artist }: { artist: ArtistRow }) {
  const { width } = useWindowDimensions();
  // Three fifths of the content width, on the cell grid.
  const size = Math.floor(((width - grid.margin * 2) * 0.6) / CELL) * CELL;
  return (
    <View className="items-center" style={{ gap: CELL * 2, paddingBottom: CELL * 2 }}>
      <ArtistImage artist={artist} size={size} large />
      <Text
        accessibilityRole="header"
        numberOfLines={2}
        className="text-center font-sans text-title1 font-light text-foreground"
        style={{ letterSpacing: -0.4 }}
      >
        {artist.name}
      </Text>
    </View>
  );
}

const albumsLine = (count: number): string => `${count} ${count === 1 ? "album" : "albums"}`;

/** What the screen shows: the artist, and their page once it is read. */
interface Shown {
  readonly artist: ArtistRow;
  /** Undefined until the page is read; the head doesn't wait for it. */
  readonly detail: ArtistDetail | undefined;
}

/** The page before it's read: the artist alone, no albums or songs yet. */
const unread = (artist: ArtistRow): ArtistDetail => ({
  artist,
  albums: [],
  appearsOn: [],
  songs: [],
});

function ArtistContent({ shown }: { shown: Shown }) {
  const loaded = shown.detail !== undefined;
  const detail = useMemo(() => shown.detail ?? unread(shown.artist), [shown.detail, shown.artist]);
  const scrollable = useListScrollable();
  const bottomInset = useChromeInset();
  const currentId = useCurrentTrackId();
  const favorites = useFavoriteIds();
  const tile = useAlbumTileSize(grid.margin);
  // In the sort chosen for artists; Play, Shuffle and rows all play this displayed order.
  const { songs } = useSortedSongs("artist", detail.songs);
  const items = useMemo(() => artistItems(detail, songs), [detail, songs]);
  // Albums and songs select together; the bar acts on them in page order.
  const selectable = useMemo(() => selectableItems(detail, songs), [detail, songs]);
  const page = useListSelection({ items: selectable, keyOf: selectableKey, target: mixedTarget });
  const albumSelection = useMemo(() => albumSelectionOf(page), [page]);
  const { selection } = page;
  const rowState = useMemo(
    () => ({ currentId, favorites, tile, selection }),
    [currentId, favorites, tile, selection],
  );
  const context = useMemo(
    () => ({ kind: "artist", id: String(detail.artist.id) }) as const,
    [detail.artist.id],
  );
  // The YT Music section's songs play as their own list, apart from the Library's.
  const ytContext = useMemo(
    () => ({ kind: "ytArtist", id: String(detail.artist.id) }) as const,
    [detail.artist.id],
  );

  const renderItem = useCallback(
    ({ item }: { item: Item }) => {
      switch (item.type) {
        case "section":
          return (
            <View className="justify-end" style={{ height: SECTION_HEAD, paddingBottom: CELL }}>
              <CatalogLine>{item.label}</CatalogLine>
            </View>
          );
        case "albums":
          return <AlbumPair albums={item.albums} size={tile} selection={albumSelection} />;
        case "track":
          return (
            <TrackRow
              track={toTrackSummary(item.song)}
              state={String(item.song.id) === currentId ? "playing" : undefined}
              favorite={favorites.has(item.song.id)}
              leading="artwork"
              {...selectableRow(
                trackItem(item.song),
                page,
                () => playSongs(songs, item.index, context),
                (options) => openTrackActions(item.song, options),
              )}
            />
          );
      }
    },
    [context, currentId, favorites, songs, tile, albumSelection, page],
  );

  const line = [
    detail.artist.albumCount > 0 ? albumsLine(detail.artist.albumCount) : null,
    songCount(loaded ? songs.length : detail.artist.trackCount),
  ]
    .filter((part) => part !== null)
    .join(" · ");

  return (
    <LegendList
      scrollEnabled={scrollable}
      className="flex-1"
      data={items}
      keyExtractor={itemKey}
      renderItem={renderItem}
      extraData={rowState}
      getItemType={(item) => item.type}
      getFixedItemSize={(item) =>
        item.type === "section"
          ? SECTION_HEAD
          : item.type === "albums"
            ? albumRowHeight(tile)
            : grid.row
      }
      estimatedItemSize={grid.row}
      recycleItems
      contentContainerStyle={{ paddingHorizontal: grid.margin, paddingBottom: bottomInset }}
      ListHeaderComponent={
        <>
          <ArtistHead artist={detail.artist} />
          <ListIntro
            line={line}
            songs={loaded ? songs : undefined}
            context={context}
            sortControl={<SongSortButton kind="artist" />}
          />
          {loaded && <ArtistStatsBlock artistId={detail.artist.id} songs={detail.songs} />}
        </>
      }
      ListFooterComponent={
        loaded ? (
          <YtArtistSection
            key={detail.artist.name}
            name={detail.artist.name}
            context={ytContext}
            selecting={page.selecting}
          />
        ) : null
      }
    />
  );
}

/**
 * An artist: their albums, the albums they appear on, their songs and, while
 * YT Music is on, the YT Music section (asked for only on a tap). Opened
 * from a list that knows the artist, the head is there on the first frame and
 * the rest follows once read.
 */
export default function ArtistScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const artistId = parseId(id);
  const detail = useArtist(artistId);
  const known = useKnownRow("artist", artistId);
  const shown: Shown | null | undefined =
    detail === undefined
      ? known === undefined
        ? undefined
        : { artist: known, detail: undefined }
      : detail === null
        ? null
        : { artist: detail.artist, detail };
  return (
    <DetailFrame detail={shown} noun="artist">
      {(artist) => <ArtistContent shown={artist} />}
    </DetailFrame>
  );
}
