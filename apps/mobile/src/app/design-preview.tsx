import { designPreviewState, type IndexEntry } from "@wave/core";
import { useLocalSearchParams } from "expo-router";
import { useMemo, useRef, useState } from "react";
import {
  FlatList,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { type AlbumSummary, AlbumTile } from "@/catalog/AlbumTile";
import { AlphabetSpine } from "@/catalog/AlphabetSpine";
import { CatalogLine } from "@/catalog/CatalogLine";
import { CELL, grid } from "@/catalog/grid";
import { TrackRow } from "@/catalog/TrackRow";
import { ScreenHeader } from "@/components/ScreenHeader";
import { Press } from "@/motion/Press";
import { PREVIEW_STATES, type PreviewState, type Shelf, StateAnchor } from "@/preview/states";
import {
  letterIndex,
  SYNTHETIC_ALBUMS,
  SYNTHETIC_TRACKS,
  type SyntheticTrack,
} from "@/preview/syntheticLibrary";

/** Fixed height of an album tile's caption block (catalog line, title, furniture). */
const CAPTION = CELL * 12;
const ROW_GAP = CELL * 3;

/**
 * The Library's components on synthetic data. Developer-only; see Settings.
 * `wave://design-preview?state=<name>` opens it at one of `PREVIEW_STATES`.
 */
export default function DesignPreviewScreen() {
  const { state } = useLocalSearchParams<{ state?: string | string[] }>();
  const opening = designPreviewState(PREVIEW_STATES, state);
  // A link naming another state starts the preview over, at that one.
  return <DesignPreview key={opening?.name ?? ""} opening={opening} />;
}

function DesignPreview({ opening }: { opening: PreviewState | undefined }) {
  const [view, setView] = useState<Shelf>(opening?.shelf ?? "albums");
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const reserved = grid.spineHit + grid.spineInset;
  const tile = Math.floor((width - grid.margin - reserved - grid.gutter) / 2);
  const tileRow = tile + CAPTION + ROW_GAP;

  const albums = useRef<FlatList<AlbumSummary>>(null);
  const songs = useRef<FlatList<SyntheticTrack>>(null);
  const scrolled = useRef(0);

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
        <View accessibilityRole="tablist" className="flex-row" style={{ gap: CELL * 3 }}>
          {(["albums", "songs"] as const).map((option) => (
            <Press
              key={option}
              accessibilityRole="tab"
              accessibilityState={{ selected: view === option }}
              onPress={() => setView(option)}
              haptic="selection"
              style={{ minHeight: 48, justifyContent: "center" }}
            >
              <Text
                className={`font-sans text-body ${
                  view === option ? "font-semibold text-foreground" : "text-secondary"
                }`}
              >
                {option === "albums" ? "Albums" : "Songs"}
              </Text>
              <View
                className={view === option ? "bg-accent" : "bg-transparent"}
                style={{ height: 2, marginTop: CELL / 2 }}
              />
            </Press>
          ))}
        </View>
      </View>

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
            renderItem={({ item }) => (
              <View style={{ height: tile + CAPTION }}>
                <AlbumTile album={item} size={tile} onPress={() => undefined} />
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
            getItemLayout={(_, index) => ({ length: grid.row, offset: grid.row * index, index })}
            contentContainerStyle={{
              paddingLeft: grid.margin,
              paddingRight: reserved,
              paddingBottom: insets.bottom + 48,
            }}
            renderItem={({ item, index }) => {
              const row = (
                <TrackRow
                  track={item.track}
                  state={item.state}
                  favorite={item.favorite}
                  leading="artwork"
                  onPress={() => undefined}
                />
              );
              return opening?.shelf === "songs" && opening.item === index ? (
                <StateAnchor open={opening.open}>{row}</StateAnchor>
              ) : (
                row
              );
            }}
          />
        )}
        <AlphabetSpine entries={entries} onJump={jump} topRow={topRow} />
      </View>
    </View>
  );
}
