import { LegendList } from "@legendapp/list/react-native";
import { useLocalSearchParams } from "expo-router";
import { useCallback, useMemo } from "react";
import { View } from "react-native";

import { CatalogLine } from "@/catalog/CatalogLine";
import { CELL, grid } from "@/catalog/grid";
import { TrackRow } from "@/catalog/TrackRow";
import { useChromeInset } from "@/chrome/chrome";
import { playSongs } from "@/playback/actions";
import { useCurrentTrackId } from "@/playback/hooks";
import { openTrackActions } from "@/playback/ActionsMenu";
import { albumPairs, albumRowHeight, AlbumPair, useAlbumTileSize } from "@/library/AlbumGrid";
import { DetailFrame } from "@/library/DetailFrame";
import { useFavoriteIds } from "@/library/favorites";
import { useArtist } from "@/library/hooks";
import type { AlbumRow, ArtistDetail, SongRow } from "@/library/LibraryStore";
import { parseId } from "@/library/routes";
import { ListIntro, songCount, toTrackSummary } from "@/library/TrackList";
import { useListScrollable } from "@/motion/heldTouch";
import { ArtistStatsBlock } from "@/stats/ArtistStatsBlock";

type Item =
  | { readonly type: "section"; readonly label: string }
  | { readonly type: "albums"; readonly albums: readonly AlbumRow[] }
  | { readonly type: "track"; readonly song: SongRow; readonly index: number };

const SECTION_HEAD = CELL * 6;

const artistItems = (detail: ArtistDetail): Item[] => {
  const items: Item[] = [];
  const shelf = (label: string, albums: readonly AlbumRow[]) => {
    if (albums.length === 0) return;
    items.push({ type: "section", label });
    for (const pair of albumPairs(albums)) items.push({ type: "albums", albums: pair });
  };
  shelf("Albums", detail.albums);
  shelf("Appears on", detail.appearsOn);
  if (detail.songs.length > 0) items.push({ type: "section", label: "Songs" });
  detail.songs.forEach((song, index) => items.push({ type: "track", song, index }));
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

const albumsLine = (count: number): string => `${count} ${count === 1 ? "album" : "albums"}`;

function ArtistContent({ detail }: { detail: ArtistDetail }) {
  const scrollable = useListScrollable();
  const bottomInset = useChromeInset();
  const currentId = useCurrentTrackId();
  const favorites = useFavoriteIds();
  const tile = useAlbumTileSize(grid.margin);
  const rowState = useMemo(() => ({ currentId, favorites, tile }), [currentId, favorites, tile]);
  const items = useMemo(() => artistItems(detail), [detail]);
  const context = useMemo(
    () => ({ kind: "artist", id: String(detail.artist.id) }) as const,
    [detail.artist.id],
  );
  const { songs } = detail;

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
          return <AlbumPair albums={item.albums} size={tile} />;
        case "track":
          return (
            <TrackRow
              track={toTrackSummary(item.song)}
              state={String(item.song.id) === currentId ? "playing" : undefined}
              favorite={favorites.has(item.song.id)}
              leading="artwork"
              onPress={() => playSongs(songs, item.index, context)}
              onLongPress={() => openTrackActions(item.song)}
            />
          );
      }
    },
    [context, currentId, favorites, songs, tile],
  );

  const line = [
    detail.artist.albumCount > 0 ? albumsLine(detail.artist.albumCount) : null,
    songCount(songs.length),
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
          <ListIntro line={line} songs={songs} context={context} />
          <ArtistStatsBlock artistId={detail.artist.id} songs={songs} />
        </>
      }
    />
  );
}

/** An artist: their albums, the albums they appear on, and their songs. */
export default function ArtistScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const detail = useArtist(parseId(id));
  return (
    <DetailFrame detail={detail} noun="artist" title={(artist) => artist.artist.name}>
      {(artist) => <ArtistContent detail={artist} />}
    </DetailFrame>
  );
}
