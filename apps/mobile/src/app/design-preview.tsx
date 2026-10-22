import { useScreenContent } from "@/lib/screenTiming";
import {
  defaultSongSort,
  designPreviewState,
  isDesignPreviewLink,
  type IndexEntry,
} from "@wave/core";
import * as Linking from "expo-linking";
import { useIsFocused, useLocalSearchParams } from "expo-router";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  FlatList,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  ScrollView,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { type AlbumSummary, AlbumTile } from "@/catalog/AlbumTile";
import { AlphabetSpine } from "@/catalog/AlphabetSpine";
import { CatalogLine } from "@/catalog/CatalogLine";
import { CELL, grid } from "@/catalog/grid";
import { PlaylistEntry } from "@/catalog/PlaylistEntry";
import { TrackRow } from "@/catalog/TrackRow";
import { ScreenHeader } from "@/components/ScreenHeader";
import { PlaylistsButtons, PlaylistsHeader } from "@/library/PlaylistsList";
import { SortButton } from "@/library/SongSortButton";
import { ListIntroLayout, songCount } from "@/library/TrackList";
import { Press } from "@/motion/Press";
import { KindCards } from "@/preview/KindCards";
import { SearchFieldStates } from "@/preview/SearchFieldStates";
import {
  type Control,
  openAlbumCard,
  openImportCard,
  openNewPlaylistPrompt,
  openSongCard,
  openSortCard,
  PREVIEW_STATES,
  type PreviewState,
  type PreviewVisit,
  type Shelf,
  StateAnchor,
  visitDesignPreview,
} from "@/preview/states";
import {
  letterIndex,
  SYNTHETIC_ALBUMS,
  SYNTHETIC_PLAYLISTS,
  SYNTHETIC_TRACKS,
  type SyntheticTrack,
} from "@/preview/syntheticLibrary";

/** Fixed height of an album tile's caption block (catalog line, title, furniture). */
const CAPTION = CELL * 12;
const ROW_GAP = CELL * 3;

const SHELVES: readonly { readonly shelf: Shelf; readonly label: string }[] = [
  { shelf: "albums", label: "Albums" },
  { shelf: "songs", label: "Songs" },
  { shelf: "playlists", label: "Playlists" },
  { shelf: "search", label: "Search" },
  { shelf: "kinds", label: "Kinds" },
];

/**
 * The Library's components, and Search's field, on synthetic data. Developer-only; see Settings › Developer.
 * `wave://design-preview?state=<name>` opens it at one of `PREVIEW_STATES`.
 */
export default function DesignPreviewScreen() {
  useScreenContent(true);
  const { state } = useLocalSearchParams<{ state?: string | string[] }>();
  const opening = designPreviewState(PREVIEW_STATES, state);
  // A link that comes in while the preview is showing (the same one again,
  // which leaves its params as they were, included) starts it over.
  const [links, setLinks] = useState(0);
  const focused = useIsFocused();
  useEffect(() => {
    if (!focused) return;
    const subscription = Linking.addEventListener("url", ({ url }) => {
      if (isDesignPreviewLink(url)) setLinks((count) => count + 1);
    });
    return () => subscription.remove();
  }, [focused]);
  // A link naming another state starts the preview over, at that one.
  return <DesignPreview key={`${opening?.name ?? ""}:${links}`} opening={opening} />;
}

function DesignPreview({ opening }: { opening: PreviewState | undefined }) {
  const [view, setView] = useState<Shelf>(opening?.shelf ?? "albums");
  // This visit: it closes what the last one's state opened, and its own as it leaves.
  const visit = useRef<PreviewVisit | undefined>(undefined);
  useEffect(() => {
    const started = visitDesignPreview();
    visit.current = started;
    return started.leave;
  }, []);
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const reserved = grid.spineHit + grid.spineInset;
  const tile = Math.floor((width - grid.margin - reserved - grid.gutter) / 2);
  const tileRow = tile + CAPTION + ROW_GAP;

  const albums = useRef<FlatList<AlbumSummary>>(null);
  const songs = useRef<FlatList<SyntheticTrack>>(null);
  const scrolled = useRef(0);
  // The state's card opens once, not again when its shelf is shown again.
  const opened = useRef(false);

  /** [node], wrapped so the state's card opens over it when it's what the state opens from. */
  const anchored = (from: number | Control, node: ReactNode): ReactNode =>
    opening?.shelf === view && opening.from === from ? (
      <StateAnchor
        current={() => visit.current?.current() ?? false}
        open={() => {
          if (opened.current) return;
          opened.current = true;
          opening.open?.();
        }}
      >
        {node}
      </StateAnchor>
    ) : (
      node
    );

  const albumLetters = useMemo(() => letterIndex(SYNTHETIC_ALBUMS.map((a) => a.title)), []);
  const songLetters = useMemo(() => letterIndex(SYNTHETIC_TRACKS.map((t) => t.track.title)), []);
  const letters = view === "albums" ? albumLetters : songLetters;
  const entries = useMemo(
    () => [...letters].map(([letter, index]) => ({ letter, index })),
    [letters],
  );

  const jump = ({ index }: IndexEntry) => {
    if (view === "albums") {
      albums.current?.scrollToOffset({ offset: Math.floor(index / 2) * tileRow, animated: false });
    } else {
      songs.current?.scrollToIndex({ index, animated: false });
    }
  };
  // The first item on screen: two albums to a row, one song.
  const topRow = () =>
    view === "albums"
      ? Math.floor(scrolled.current / tileRow) * 2
      : Math.floor(scrolled.current / grid.row);
  const onScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    scrolled.current = event.nativeEvent.contentOffset.y;
  };

  return (
    <View className="flex-1 bg-background">
      <ScreenHeader title="Design preview" />
      <View style={{ paddingHorizontal: grid.margin, gap: CELL * 2, paddingBottom: CELL * 2 }}>
        <CatalogLine>Synthetic data · not your library</CatalogLine>
        <View accessibilityRole="tablist" className="flex-row" style={{ gap: CELL * 2 }}>
          {SHELVES.map(({ shelf, label }) => (
            <Press
              key={shelf}
              accessibilityRole="tab"
              accessibilityState={{ selected: view === shelf }}
              onPress={() => {
                if (shelf === view) return;
                // The shelf's list starts at its top; the spine reads its offset.
                scrolled.current = 0;
                setView(shelf);
              }}
              haptic="selection"
              style={{ minHeight: 48, justifyContent: "center" }}
            >
              <Text
                className={`font-sans text-body ${
                  view === shelf ? "font-semibold text-foreground" : "text-secondary"
                }`}
              >
                {label}
              </Text>
              <View
                className={view === shelf ? "bg-accent" : "bg-transparent"}
                style={{ height: 2, marginTop: CELL / 2 }}
              />
            </Press>
          ))}
        </View>
      </View>

      {view === "kinds" ? (
        <KindCards />
      ) : view === "search" ? (
        <SearchFieldStates />
      ) : view === "playlists" ? (
        // Library › Playlists: its count, Import Playlists and New Playlist, then the playlists.
        <ScrollView
          contentContainerStyle={{
            paddingHorizontal: grid.margin,
            paddingBottom: insets.bottom + 48,
          }}
        >
          <PlaylistsHeader count={SYNTHETIC_PLAYLISTS.length}>
            {/* As with YT Music on: Import Playlists opens a card. */}
            <PlaylistsButtons
              importOpensMenu
              onImport={openImportCard}
              onNewPlaylist={openNewPlaylistPrompt}
              wrap={anchored}
            />
          </PlaylistsHeader>
          {SYNTHETIC_PLAYLISTS.map((playlist) => (
            <PlaylistEntry
              key={playlist.id}
              name={playlist.name}
              detail={songCount(playlist.trackCount)}
              paths={[]}
              onPress={() => undefined}
            />
          ))}
        </ScrollView>
      ) : (
        <>
          {view === "songs" && (
            // A song list's opening, as `ListIntro` draws it: the count over Play, Shuffle and Sort.
            <View style={{ paddingHorizontal: grid.margin }}>
              <ListIntroLayout
                line={songCount(SYNTHETIC_TRACKS.length)}
                onPlay={() => undefined}
                onShuffle={() => undefined}
                sortControl={anchored(
                  "sort",
                  <SortButton sort={defaultSongSort("songs")} onPress={openSortCard} />,
                )}
              />
            </View>
          )}
          <View className="flex-1">
            {view === "albums" ? (
              <FlatList
                key="albums"
                ref={albums}
                onScroll={onScroll}
                data={SYNTHETIC_ALBUMS}
                keyExtractor={(album) => album.id}
                numColumns={2}
                columnWrapperStyle={{ gap: grid.gutter }}
                contentContainerStyle={{
                  paddingLeft: grid.margin,
                  paddingRight: reserved,
                  paddingBottom: insets.bottom + 48,
                  gap: ROW_GAP,
                }}
                renderItem={({ item, index }) => (
                  <View style={{ height: tile + CAPTION }}>
                    {anchored(
                      index,
                      <AlbumTile
                        album={item}
                        size={tile}
                        onPress={() => undefined}
                        onLongPress={() => openAlbumCard(item)}
                      />,
                    )}
                  </View>
                )}
              />
            ) : (
              <FlatList
                key="songs"
                ref={songs}
                onScroll={onScroll}
                data={SYNTHETIC_TRACKS}
                keyExtractor={(item) => item.track.id}
                getItemLayout={(_, index) => ({
                  length: grid.row,
                  offset: grid.row * index,
                  index,
                })}
                contentContainerStyle={{
                  paddingLeft: grid.margin,
                  paddingRight: reserved,
                  paddingBottom: insets.bottom + 48,
                }}
                renderItem={({ item, index }) =>
                  anchored(
                    index,
                    <TrackRow
                      track={item.track}
                      state={item.state}
                      favorite={item.favorite}
                      leading="artwork"
                      onPress={() => undefined}
                      onLongPress={() => openSongCard(item)}
                    />,
                  )
                }
              />
            )}
            <AlphabetSpine entries={entries} onJump={jump} topRow={topRow} />
          </View>
        </>
      )}
    </View>
  );
}
