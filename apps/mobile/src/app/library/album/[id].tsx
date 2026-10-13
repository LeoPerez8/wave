import { LegendList } from "@legendapp/list/react-native";
import { useLocalSearchParams } from "expo-router";
import { useCallback, useMemo } from "react";
import { Text, useWindowDimensions, View } from "react-native";

import { Artwork } from "@/catalog/Artwork";
import { CatalogLine } from "@/catalog/CatalogLine";
import { CELL, grid } from "@/catalog/grid";
import { PlayShuffle } from "@/catalog/PlayShuffle";
import { TrackRow } from "@/catalog/TrackRow";
import { useChromeInset } from "@/chrome/chrome";
import { Press } from "@/motion/Press";
import { playSongs } from "@/playback/actions";
import { useCurrentTrackId, usePlaySongs } from "@/playback/hooks";
import { openTrackActions } from "@/playback/ActionsMenu";
import { DetailFrame } from "@/library/DetailFrame";
import { useFavoriteIds } from "@/library/favorites";
import { useAlbum, useLinkRows } from "@/library/hooks";
import type { AlbumRow, AlbumTrackRow } from "@/library/LibraryStore";
import { openArtist, parseId, useKnownRow } from "@/library/routes";
import { songCount, toTrackSummary } from "@/library/TrackList";
import { useListScrollable } from "@/motion/heldTouch";
import type { ActionItems } from "@/playback/actionTargets";
import { selectableRow } from "@/selection/selectableRow";
import { useListSelection } from "@/selection/useListSelection";

type Item =
  | { readonly type: "disc"; readonly disc: number }
  | { readonly type: "track"; readonly track: AlbumTrackRow; readonly index: number };

const DISC_HEAD = CELL * 6;

const trackKey = (track: AlbumTrackRow): string => String(track.id);

/** In selection mode the bar acts on the checked tracks, in disc and track order. */
const tracksOf = (tracks: readonly AlbumTrackRow[]): ActionItems => ({
  kind: "track",
  items: tracks.map((song) => ({ song })),
});

/** Tracks in album order, with a "Disc n" head before each disc when there is more than one. */
const albumItems = (tracks: readonly AlbumTrackRow[]): Item[] => {
  const discs = new Set(tracks.map((track) => track.discNumber ?? 1));
  const items: Item[] = [];
  let disc: number | null = null;
  tracks.forEach((track, index) => {
    const current = track.discNumber ?? 1;
    if (discs.size > 1 && current !== disc) items.push({ type: "disc", disc: current });
    disc = current;
    items.push({ type: "track", track, index });
  });
  return items;
};

/** What the screen shows: the album, and its tracks (and genre) once they are read. */
interface Shown {
  readonly album: AlbumRow;
  readonly genre: string | null;
  /** Undefined until the tracks are read; the header doesn't wait for them. */
  readonly tracks: readonly AlbumTrackRow[] | undefined;
}

const NO_TRACKS: readonly AlbumTrackRow[] = [];

const itemKey = (item: Item): string =>
  item.type === "disc" ? `disc-${item.disc}` : String(item.track.id);

function AlbumHead({ shown }: { shown: Shown }) {
  const { width } = useWindowDimensions();
  const { album, genre, tracks } = shown;
  const context = useMemo(() => ({ kind: "album", id: String(album.id) }) as const, [album.id]);
  const play = usePlaySongs(tracks, context);
  // Read ahead, so the artist's screen opens header-first.
  const { artist } = useLinkRows(undefined, album.albumArtistId);
  // "Rock · 1997 · 12 songs · 52 min": the grid's furniture line, spelled out.
  const furniture = [
    genre,
    album.year,
    songCount(album.trackCount),
    `${Math.max(1, Math.round(album.durationMs / 60_000))} min`,
  ]
    .filter((part) => part !== null)
    .join(" · ");
  return (
    <View style={{ gap: CELL * 2, paddingBottom: CELL }}>
      <Artwork
        uri={album.artworkPath === null ? undefined : `file://${album.artworkPath}`}
        size={width - grid.margin * 2}
      />
      <View style={{ gap: CELL / 2 }}>
        <Text
          accessibilityRole="header"
          className="font-sans text-title1 font-light text-foreground"
          style={{ letterSpacing: -0.4 }}
        >
          {album.title}
        </Text>
        <Press
          accessibilityRole="link"
          accessibilityLabel={`Go to ${album.albumArtist}`}
          onPress={() => openArtist(album.albumArtistId, artist)}
          haptic="selection"
          className="self-start justify-center"
          style={{ minHeight: 48 }}
        >
          <Text className="font-sans text-body font-medium text-accent">{album.albumArtist}</Text>
        </Press>
        <Text
          className="font-sans text-footnote text-secondary"
          style={{ fontVariant: ["tabular-nums"] }}
        >
          {furniture}
        </Text>
      </View>
      <PlayShuffle onPlay={() => play(false)} onShuffle={() => play(true)} />
    </View>
  );
}

function AlbumTracks({ shown }: { shown: Shown }) {
  const tracks = shown.tracks ?? NO_TRACKS;
  const scrollable = useListScrollable();
  const bottomInset = useChromeInset();
  const currentId = useCurrentTrackId();
  const favorites = useFavoriteIds();
  // Selection keys the tracks themselves (every disc), not the disc heads.
  const listSelection = useListSelection({
    items: tracks,
    keyOf: trackKey,
    target: tracksOf,
  });
  const rowState = useMemo(
    () => ({ currentId, favorites, selection: listSelection.selection }),
    [currentId, favorites, listSelection.selection],
  );
  const items = useMemo(() => albumItems(tracks), [tracks]);
  const context = useMemo(
    () => ({ kind: "album", id: String(shown.album.id) }) as const,
    [shown.album.id],
  );

  const renderItem = useCallback(
    ({ item }: { item: Item }) =>
      item.type === "disc" ? (
        <View className="justify-end" style={{ height: DISC_HEAD, paddingBottom: CELL }}>
          <CatalogLine>{`Disc ${item.disc}`}</CatalogLine>
        </View>
      ) : (
        <TrackRow
          track={{
            ...toTrackSummary(item.track),
            trackNumber: item.track.trackNumber ?? undefined,
          }}
          state={String(item.track.id) === currentId ? "playing" : undefined}
          favorite={favorites.has(item.track.id)}
          leading="number"
          {...selectableRow(
            item.track,
            listSelection,
            () => playSongs(tracks, item.index, context),
            (options) => openTrackActions(item.track, options),
          )}
        />
      ),
    [context, currentId, tracks, favorites, listSelection],
  );

  return (
    <LegendList
      scrollEnabled={scrollable}
      className="flex-1"
      data={items}
      keyExtractor={itemKey}
      renderItem={renderItem}
      extraData={rowState}
      getItemType={(item) => item.type}
      getFixedItemSize={(item) => (item.type === "disc" ? DISC_HEAD : grid.row)}
      estimatedItemSize={grid.row}
      recycleItems
      contentContainerStyle={{ paddingHorizontal: grid.margin, paddingBottom: bottomInset }}
      ListHeaderComponent={<AlbumHead shown={shown} />}
    />
  );
}

/**
 * An album: large cover, title, album artist, furniture, Play / Shuffle,
 * tracks by disc and number. Opened from a list that knows the album, the
 * header is there on the first frame and the tracks follow once read.
 */
export default function AlbumScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const albumId = parseId(id);
  const detail = useAlbum(albumId);
  const known = useKnownRow("album", albumId);
  const shown: Shown | null | undefined =
    detail === undefined && known !== undefined
      ? { album: known, genre: null, tracks: undefined }
      : detail;
  return (
    <DetailFrame detail={shown} noun="album">
      {(album) => <AlbumTracks shown={album} />}
    </DetailFrame>
  );
}
