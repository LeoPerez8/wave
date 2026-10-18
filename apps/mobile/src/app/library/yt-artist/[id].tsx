import { LegendList } from "@legendapp/list/react-native";
import { IconUser } from "@tabler/icons-react-native";
import {
  artistInitial,
  artistPageItems,
  type ArtistPageItem,
  type DiscoverSong,
  type YtArtistPageNote,
  type YtArtistRelease,
  type YtArtistShelf,
} from "@wave/core";
import { Image } from "expo-image";
import { useLocalSearchParams } from "expo-router";
import { useCallback, useMemo } from "react";
import { Text, useWindowDimensions, View } from "react-native";

import { AlbumTile } from "@/catalog/AlbumTile";
import { SECTION_HEAD, SectionHead } from "@/catalog/CatalogLine";
import { COVER_ROW_TILE, CoverRow } from "@/catalog/CoverRow";
import { CELL, grid } from "@/catalog/grid";
import { PlayShuffle } from "@/catalog/PlayShuffle";
import {
  HiddenSkeletonBox,
  HiddenSkeletonLine,
  PlayShuffleSkeleton,
  TrackSkeletons,
} from "@/catalog/Skeletons";
import { useChromeInset } from "@/chrome/chrome";
import { ScreenHeader } from "@/components/ScreenHeader";
import { TextButton } from "@/components/TextButton";
import { albumRowHeight, toAlbumSummary } from "@/library/AlbumGrid";
import type { AlbumRow, SongRow } from "@/library/LibraryStore";
import { openAlbum } from "@/library/routes";
import { useListScrollable } from "@/motion/heldTouch";
import type { NativeYtSong } from "@/native/waveYtMusic";
import { openAlbumActions } from "@/playback/ActionsMenu";
import { playPage } from "@/playback/actions";
import { listedTrackItem, trackItemKey, tracksTarget } from "@/playback/actionTargets";
import { useListSelection } from "@/selection/useListSelection";
import { useThemeColor } from "@/theme/useThemeColor";
import { useYtArtistPage } from "@/ytmusic/artistPage";
import { DiscoverSongRow } from "@/ytmusic/DiscoverSongRow";
import { YT_ARTIST_NOTE, YtReleaseTile } from "@/ytmusic/YtArtistSection";
import { YT_ARTIST_BY_NAME } from "@/ytmusic/routes";

type Song = DiscoverSong<NativeYtSong, SongRow>;
type Release = YtArtistRelease<AlbumRow>;

/** A cover on a shelf: the release, and the shelf it's on (its furniture line falls back to it). */
interface Cover {
  readonly kind: YtArtistShelf<AlbumRow>["kind"];
  readonly release: Release;
}

type Item = ArtistPageItem<Cover, Song>;

/** Height of a shelf's row, the gap under it included. */
const SHELF_ROW = albumRowHeight(COVER_ROW_TILE);

const NO_SONGS: readonly Song[] = [];

const SHELF_LABEL = { albums: "Albums", singles: "Singles & EPs" } as const;

/** The quiet line in place of what the page can't show (while it loads, skeletons show). */
const NOTE: Readonly<Record<Exclude<YtArtistPageNote, "loading">, string>> = {
  offline: YT_ARTIST_NOTE.offline,
  failed: YT_ARTIST_NOTE.failed,
  off: "YT Music is off. Turn it on in Settings to see this artist.",
  notFound: YT_ARTIST_NOTE.notFound,
};

/** As the integrated Library artist page lays it out: the releases, then the songs. */
const pageItems = (shelves: readonly YtArtistShelf<AlbumRow>[], songs: readonly Song[]): Item[] =>
  artistPageItems(
    shelves.map((shelf) => ({
      label: SHELF_LABEL[shelf.kind],
      covers: shelf.releases.map((release): Cover => ({ kind: shelf.kind, release })),
    })),
    songs,
  );

const itemKey = (item: Item): string => {
  switch (item.type) {
    case "section":
      return `section-${item.label}`;
    case "shelf":
      return `shelf-${item.label}`;
    case "song":
      return `song-${item.index}-${item.song.song.videoId}`;
  }
};

/**
 * A shelf as one row of covers that scrolls sideways: a release the Library
 * has is its album, opened integrated as the page always is; the others are
 * YouTube Music's.
 */
function ReleaseRow({ covers, selecting }: { covers: readonly Cover[]; selecting: boolean }) {
  return (
    <View style={{ height: SHELF_ROW }}>
      <CoverRow>
        {covers.map(({ kind, release: { album, library } }) =>
          library === null ? (
            <YtReleaseTile
              key={album.browseId}
              album={album}
              kind={kind}
              size={COVER_ROW_TILE}
              selecting={selecting}
            />
          ) : (
            <AlbumTile
              key={`album-${library.id}`}
              album={toAlbumSummary(library)}
              size={COVER_ROW_TILE}
              onPress={() => {
                if (!selecting) openAlbum(library.id, library, { integrated: true });
              }}
              onLongPress={() => {
                if (!selecting) openAlbumActions(library);
              }}
            />
          ),
        )}
      </CoverRow>
    </View>
  );
}

/** The artist's image from YouTube Music as a large circle, else their initial. */
function YtArtistImage({ name, uri, size }: { name: string; uri: string | null; size: number }) {
  const secondary = useThemeColor("secondary");
  const fill = useThemeColor("fill");
  const circle = { width: size, height: size, borderRadius: size / 2 };
  if (uri !== null)
    return (
      <Image
        source={{ uri }}
        style={[circle, { backgroundColor: fill }]}
        contentFit="cover"
        accessibilityIgnoresInvertColors
      />
    );
  const initial = artistInitial(name);
  return (
    <View className="items-center justify-center overflow-hidden bg-fill" style={circle}>
      {initial === "" ? (
        <IconUser size={size / 3} color={secondary} strokeWidth={1.25} />
      ) : (
        <Text
          className="font-sans font-light text-secondary"
          style={{ fontSize: size * 0.42, lineHeight: size * 0.52 }}
          allowFontScaling={false}
        >
          {initial}
        </Text>
      )}
    </View>
  );
}

/**
 * The page's head, as the Library artist page's: image, name, then Play and
 * Shuffle. While the page loads ([loading]) a still circle stands in for an
 * image not known yet, a line for a name not known yet, and Play and Shuffle
 * have their skeleton.
 */
function Head({
  name,
  artworkUrl,
  loading,
  onPlay,
}: {
  name: string | null;
  artworkUrl: string | null;
  loading: boolean;
  onPlay: ((shuffle: boolean) => void) | null;
}) {
  const { width } = useWindowDimensions();
  // Three fifths of the content width, on the cell grid.
  const size = Math.floor(((width - grid.margin * 2) * 0.6) / CELL) * CELL;
  return (
    <View style={{ gap: CELL * 2, paddingBottom: CELL * 2 }}>
      <View className="items-center" style={{ gap: CELL * 2 }}>
        {loading && artworkUrl === null ? (
          <HiddenSkeletonBox width={size} height={size} radius={size / 2} />
        ) : (
          <YtArtistImage name={name ?? ""} uri={artworkUrl} size={size} />
        )}
        {name === null ? (
          // A title line (global.css's title1), its bar centred under the circle.
          <View style={{ width: size * 0.8 }}>
            <HiddenSkeletonLine lineHeight={34} width="100%" />
          </View>
        ) : (
          <Text
            accessibilityRole="header"
            numberOfLines={2}
            className="text-center font-sans text-title1 font-light text-foreground"
            style={{ letterSpacing: -0.4 }}
          >
            {name}
          </Text>
        )}
      </View>
      {loading ? (
        <PlayShuffleSkeleton />
      ) : (
        onPlay !== null && (
          <PlayShuffle onPlay={() => onPlay(false)} onShuffle={() => onPlay(true)} />
        )
      )}
    </View>
  );
}

/** A quiet line (offline, YT Music off…) and Try Again when it can be asked again. */
function QuietLine({
  note,
  retry,
  onRetry,
}: {
  note: string | null;
  retry: boolean;
  onRetry: () => void;
}) {
  if (note === null && !retry) return null;
  return (
    <View style={{ paddingTop: CELL * 2 }}>
      {note !== null && (
        <View className="justify-center" style={{ minHeight: CELL * 6 }}>
          <Text className="font-sans text-footnote text-secondary">{note}</Text>
        </View>
      )}
      {retry && <TextButton label="Try Again" onPress={onRetry} />}
    </View>
  );
}

/**
 * A YouTube Music artist the Library doesn't have, opened by their browse id
 * (`/library/yt-artist/<UC…>?name=<name>`) or, from a streamed song, by their
 * name (`/library/yt-artist/by-name?name=<name>`, found with an Artists
 * search; "Not found online." when nobody matches): their image and
 * name, Play and Shuffle, their Albums and Singles & EPs (a release the Library has opens
 * the Library album) and every song of theirs, their songs playlist read
 * whole (the Library's play its files, the rest stream). It's read as it opens and saved for a week; offline or
 * failing, a quiet line with Try Again; with YT Music off, it says so.
 */
export default function YtArtistScreen() {
  const params = useLocalSearchParams<{ id: string; name?: string }>();
  const browseId = params.id === YT_ARTIST_BY_NAME ? null : (params.id ?? "");
  const knownName = params.name === undefined || params.name === "" ? null : params.name;
  const scrollable = useListScrollable();
  const bottomInset = useChromeInset();
  const { view, retry } = useYtArtistPage(browseId, knownName);
  const songs = view?.songs ?? NO_SONGS;
  const selectable = useMemo(() => songs.map(listedTrackItem), [songs]);
  const selection = useListSelection({
    items: selectable,
    keyOf: trackItemKey,
    target: tracksTarget,
  });
  const items = useMemo(() => (view === null ? [] : pageItems(view.shelves, view.songs)), [view]);
  const contextId = browseId ?? `name:${knownName ?? ""}`;
  const context = useMemo(() => ({ kind: "ytArtist", id: contextId }) as const, [contextId]);
  const play = useCallback(
    (startIndex: number | undefined, shuffle = false) =>
      void playPage(songs, startIndex, context, { shuffle }),
    [songs, context],
  );
  const name = view?.name ?? knownName;
  // Until the artist's page is in, skeletons hold its place (the view waits on the Library first).
  const loading = view === null || view.note === "loading";

  const renderItem = useCallback(
    ({ item }: { item: Item }) => {
      switch (item.type) {
        case "section":
          return <SectionHead label={item.label} />;
        case "shelf":
          // Keyed by shelf, so a recycled row doesn't keep another shelf's scroll position.
          return (
            <ReleaseRow key={item.label} covers={item.covers} selecting={selection.selecting} />
          );
        case "song":
          return (
            <DiscoverSongRow
              song={item.song}
              selection={selection}
              onPress={() => play(item.index)}
            />
          );
      }
    },
    [play, selection],
  );

  return (
    <View className="flex-1 bg-background">
      <ScreenHeader />
      <LegendList
        scrollEnabled={scrollable}
        className="flex-1"
        data={items}
        keyExtractor={itemKey}
        renderItem={renderItem}
        extraData={selection.selection}
        getItemType={(item) => item.type}
        getFixedItemSize={(item) =>
          item.type === "section" ? SECTION_HEAD : item.type === "shelf" ? SHELF_ROW : grid.row
        }
        estimatedItemSize={grid.row}
        recycleItems
        contentContainerStyle={{ paddingHorizontal: grid.margin, paddingBottom: bottomInset }}
        ListHeaderComponent={
          name === null && !loading ? null : (
            <Head
              name={name}
              artworkUrl={view?.artworkUrl ?? null}
              loading={loading}
              onPlay={songs.length === 0 ? null : (shuffle) => play(undefined, shuffle)}
            />
          )
        }
        ListFooterComponent={
          loading ? (
            <TrackSkeletons />
          ) : view === null ? null : (
            <QuietLine
              note={view.note === null ? null : NOTE[view.note]}
              retry={view.retry}
              onRetry={retry}
            />
          )
        }
      />
    </View>
  );
}
