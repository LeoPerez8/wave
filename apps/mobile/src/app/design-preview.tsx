import { useMemo, useRef, useState } from "react";
import { FlatList, Text, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { type AlbumSummary, AlbumTile } from "@/catalog/AlbumTile";
import { AlphabetSpine } from "@/catalog/AlphabetSpine";
import { CatalogLine } from "@/catalog/CatalogLine";
import { CELL, grid } from "@/catalog/grid";
import { TrackRow } from "@/catalog/TrackRow";
import { ScreenHeader } from "@/components/ScreenHeader";
import { Press } from "@/motion/Press";
import {
  letterIndex,
  SYNTHETIC_ALBUMS,
  SYNTHETIC_TRACKS,
  type SyntheticTrack,
} from "@/preview/syntheticLibrary";

type Shelf = "albums" | "songs";

/** Fixed height of an album tile's caption block (catalog line, title, furniture). */
const CAPTION = CELL * 9;
const ROW_GAP = CELL * 3;

/** The Library's components on synthetic data. Developer-only; see Settings. */
export default function DesignPreviewScreen() {
  const [view, setView] = useState<Shelf>("albums");
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const tile = Math.floor((width - grid.margin - grid.spine - grid.gutter) / 2);
  const tileRow = tile + CAPTION + ROW_GAP;

  const albums = useRef<FlatList<AlbumSummary>>(null);
  const songs = useRef<FlatList<SyntheticTrack>>(null);

  const albumLetters = useMemo(() => letterIndex(SYNTHETIC_ALBUMS.map((a) => a.title)), []);
  const songLetters = useMemo(() => letterIndex(SYNTHETIC_TRACKS.map((t) => t.track.title)), []);
  const letters = view === "albums" ? albumLetters : songLetters;

  const jump = (letter: string) => {
    const index = letters.get(letter);
    if (index === undefined) return;
    if (view === "albums") {
      albums.current?.scrollToOffset({ offset: Math.floor(index / 2) * tileRow, animated: false });
    } else {
      songs.current?.scrollToIndex({ index, animated: false });
    }
  };

  return (
    <View className="flex-1 bg-background">
      <ScreenHeader title="Design preview" />
      <View style={{ paddingHorizontal: grid.margin, gap: CELL * 2, paddingBottom: CELL * 2 }}>
        <CatalogLine tone="highlight">Synthetic data · not your library</CatalogLine>
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
            ref={albums}
            data={SYNTHETIC_ALBUMS}
            keyExtractor={(album) => album.id}
            numColumns={2}
            columnWrapperStyle={{ gap: grid.gutter }}
            contentContainerStyle={{
              paddingLeft: grid.margin,
              paddingRight: grid.spine,
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
            ref={songs}
            data={SYNTHETIC_TRACKS}
            keyExtractor={(item) => item.track.id}
            getItemLayout={(_, index) => ({ length: grid.row, offset: grid.row * index, index })}
            contentContainerStyle={{
              paddingLeft: grid.margin,
              paddingRight: grid.spine + CELL,
              paddingBottom: insets.bottom + 48,
            }}
            renderItem={({ item }) => (
              <TrackRow
                track={item.track}
                state={item.state}
                favorite={item.favorite}
                leading="artwork"
                onPress={() => undefined}
              />
            )}
          />
        )}
        <AlphabetSpine letters={[...letters.keys()]} onLetter={jump} />
      </View>
    </View>
  );
}
