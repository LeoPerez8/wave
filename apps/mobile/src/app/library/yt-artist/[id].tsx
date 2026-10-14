import { LegendList } from "@legendapp/list/react-native";
import { IconUser } from "@tabler/icons-react-native";
import {
  artistInitial,
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
import { CatalogLine } from "@/catalog/CatalogLine";
import { CELL, grid } from "@/catalog/grid";
import { PlayShuffle } from "@/catalog/PlayShuffle";
import { useChromeInset } from "@/chrome/chrome";
import { ScreenHeader } from "@/components/ScreenHeader";
import { TextButton } from "@/components/TextButton";
import { albumRowHeight, toAlbumSummary, useAlbumTileSize } from "@/library/AlbumGrid";
import type { AlbumRow, SongRow } from "@/library/LibraryStore";
import { openAlbum } from "@/library/routes";
import { useListScrollable } from "@/motion/heldTouch";
import type { NativeYtSong } from "@/native/waveYtMusic";
import { openAlbumActions } from "@/playback/ActionsMenu";
import { playPage } from "@/playback/actions";
import { useThemeColor } from "@/theme/useThemeColor";
import { useYtArtistPage } from "@/ytmusic/artistPage";
import { DiscoverSongRow } from "@/ytmusic/DiscoverShelves";
import { YT_ARTIST_NOTE, YtReleaseTile } from "@/ytmusic/YtArtistSection";
import { YT_ARTIST_BY_NAME } from "@/ytmusic/routes";

type Song = DiscoverSong<NativeYtSong, SongRow>;
type Release = YtArtistRelease<AlbumRow>;

type Item =
  | { readonly type: "section"; readonly label: string }
  | {
      readonly type: "releases";
      readonly kind: YtArtistShelf<AlbumRow>["kind"];
      readonly releases: readonly Release[];
    }
  | { readonly type: "song"; readonly song: Song; readonly index: number };

const SECTION_HEAD = CELL * 6;

const NO_SONGS: readonly Song[] = [];

const SHELF_LABEL = { albums: "Albums", singles: "Singles & EPs" } as const;

/** The quiet line in place of what the page can't show. */
const NOTE: Readonly<Record<YtArtistPageNote, string>> = {
  loading: YT_ARTIST_NOTE.loading,
  offline: YT_ARTIST_NOTE.offline,
  failed: YT_ARTIST_NOTE.failed,
  off: "YT Music is off. Turn it on in Settings to see this artist.",
  notFound: YT_ARTIST_NOTE.notFound,
};

/** As the integrated Library artist page lays it out: the releases, then the songs. */
const pageItems = (shelves: readonly YtArtistShelf<AlbumRow>[], songs: readonly Song[]): Item[] => {
  const items: Item[] = [];
  for (const shelf of shelves) {
    items.push({ type: "section", label: SHELF_LABEL[shelf.kind] });
    for (let i = 0; i < shelf.releases.length; i += 2)
      items.push({ type: "releases", kind: shelf.kind, releases: shelf.releases.slice(i, i + 2) });
  }
  if (songs.length > 0) items.push({ type: "section", label: "Songs" });
  songs.forEach((song, index) => items.push({ type: "song", song, index }));
  return items;
};

const releaseKey = (release: Release): string =>
  release.library === null ? release.album.browseId : `album-${release.library.id}`;

const itemKey = (item: Item): string => {
  switch (item.type) {
    case "section":
      return `section-${item.label}`;
    case "releases":
      return `${item.kind}-${item.releases.map(releaseKey).join("-")}`;
    case "song":
      return `song-${item.index}-${item.song.song.videoId}`;
  }
};

/** A row of a shelf: a release the Library has is its album; the others are YouTube Music's. */
function ReleasePair({
  kind,
  releases,
  size,
}: {
  kind: YtArtistShelf<AlbumRow>["kind"];
  releases: readonly Release[];
  size: number;
}) {
  return (
    <View className="flex-row" style={{ gap: grid.gutter, height: albumRowHeight(size) }}>
      {releases.map(({ album, library }) =>
        library === null ? (
          <YtReleaseTile
            key={album.browseId}
            album={album}
            kind={kind}
            size={size}
            selecting={false}
          />
        ) : (
          <AlbumTile
            key={`album-${library.id}`}
            album={toAlbumSummary(library)}
            size={size}
            onPress={() => openAlbum(library.id, library)}
            onLongPress={() => openAlbumActions(library)}
          />
        ),
      )}
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

/** The page's head, as the Library artist page's: image, name, then Play and Shuffle. */
function Head({
  name,
  artworkUrl,
  onPlay,
}: {
  name: string;
  artworkUrl: string | null;
  onPlay: ((shuffle: boolean) => void) | null;
}) {
  const { width } = useWindowDimensions();
  // Three fifths of the content width, on the cell grid.
  const size = Math.floor(((width - grid.margin * 2) * 0.6) / CELL) * CELL;
  return (
    <View style={{ gap: CELL * 2, paddingBottom: CELL * 2 }}>
      <View className="items-center" style={{ gap: CELL * 2 }}>
        <YtArtistImage name={name} uri={artworkUrl} size={size} />
        <Text
          accessibilityRole="header"
          numberOfLines={2}
          className="text-center font-sans text-title1 font-light text-foreground"
          style={{ letterSpacing: -0.4 }}
        >
          {name}
        </Text>
      </View>
      {onPlay !== null && (
        <PlayShuffle onPlay={() => onPlay(false)} onShuffle={() => onPlay(true)} />
      )}
    </View>
  );
}

/** A quiet line (looking, offline, YT Music off…) and Try Again when it can be asked again. */
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
 * search; "Not found on YouTube Music" when nobody matches): their image and
 * name, Play and Shuffle, their Albums and Singles & EPs (a release the Library has opens
 * the Library album) and their top songs (the Library's play its files, the
 * rest stream). It's read as it opens and saved for a week; offline or
 * failing, a quiet line with Try Again; with YT Music off, it says so.
 */
export default function YtArtistScreen() {
  const params = useLocalSearchParams<{ id: string; name?: string }>();
  const browseId = params.id === YT_ARTIST_BY_NAME ? null : (params.id ?? "");
  const knownName = params.name === undefined || params.name === "" ? null : params.name;
  const scrollable = useListScrollable();
  const bottomInset = useChromeInset();
  const tile = useAlbumTileSize(grid.margin);
  const { view, retry } = useYtArtistPage(browseId, knownName);
  const songs = view?.songs ?? NO_SONGS;
  const items = useMemo(() => (view === null ? [] : pageItems(view.shelves, view.songs)), [view]);
  const contextId = browseId ?? `name:${knownName ?? ""}`;
  const context = useMemo(() => ({ kind: "ytArtist", id: contextId }) as const, [contextId]);
  const play = useCallback(
    (startIndex: number | undefined, shuffle = false) =>
      void playPage(songs, startIndex, context, { shuffle }),
    [songs, context],
  );
  const name = view?.name ?? knownName;

  const renderItem = useCallback(
    ({ item }: { item: Item }) => {
      switch (item.type) {
        case "section":
          return (
            <View className="justify-end" style={{ height: SECTION_HEAD, paddingBottom: CELL }}>
              <CatalogLine>{item.label}</CatalogLine>
            </View>
          );
        case "releases":
          return <ReleasePair kind={item.kind} releases={item.releases} size={tile} />;
        case "song":
          return <DiscoverSongRow song={item.song} onPress={() => play(item.index)} />;
      }
    },
    [play, tile],
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
        extraData={tile}
        getItemType={(item) => item.type}
        getFixedItemSize={(item) =>
          item.type === "section"
            ? SECTION_HEAD
            : item.type === "releases"
              ? albumRowHeight(tile)
              : grid.row
        }
        estimatedItemSize={grid.row}
        recycleItems
        contentContainerStyle={{ paddingHorizontal: grid.margin, paddingBottom: bottomInset }}
        ListHeaderComponent={
          name === null ? null : (
            <Head
              name={name}
              artworkUrl={view?.artworkUrl ?? null}
              onPlay={songs.length === 0 ? null : (shuffle) => play(undefined, shuffle)}
            />
          )
        }
        ListFooterComponent={
          view === null ? null : (
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
