import {
  DEFAULT_DJ_SETTINGS,
  djCanStart,
  djCells,
  djGrid,
  djOpened,
  djPagesNeeded,
  djReduce,
  djSeedTiles,
  djSelectable,
  djSelected,
  type DjArtistTile,
  type DjState,
  type DjTileKey,
  identityKey,
} from "@wave/core";
import { IconArrowLeft, IconX } from "@tabler/icons-react-native";
import { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, ScrollView, Text, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ArtistImage } from "@/catalog/ArtistImage";
import { CardTile, CardTitle, titleLineHeight } from "@/catalog/cards/CardParts";
import { TileCheck } from "@/catalog/CheckCell";
import { CELL, grid, widthOf } from "@/catalog/grid";
import { SkeletonLine } from "@/catalog/SkeletonLine";
import { IconButton } from "@/components/IconButton";
import { RecommendationsFailed } from "@/components/RecommendationsFailed";
import { TextButton } from "@/components/TextButton";
import { magicQueueGrid } from "@/home/homeOpening";
import type { MixIndexes } from "@/home/mixKnown";
import { recommendationSnapshot } from "@/home/recommendationSnapshot";
import { savedYtArtist } from "@/home/ytArtistPage";
import { useScreenContent } from "@/lib/screenTiming";
import { router } from "@/lib/timingRouter";
import { appRuntime } from "@/library/runtime";
import { useLocalisation } from "@/localisation/localisation";
import { online } from "@/native/waveNative";
import { addScreenBackHandler } from "@/overlay/back";
import { startDjMagicQueue } from "@/playback/MagicQueue";
import { latestTasteProfile } from "@/playback/TasteProfile";
import { ytMusicEnabled } from "@/settings/ytMusic";
import { usePlayedArtist } from "@/stats/PlayedEntityViews";
import { useThemeColor } from "@/theme/useThemeColor";
import { fetchArtist } from "@/ytmusic/artistSection";
import type { ArtistRow } from "@wave/client";

import { DjAdjust } from "./DjAdjust";
import { runDjDone, type DjDone } from "./djDone";
import { readDjSimilar } from "./djSimilar";

/** The Library's artists by id, for the tiles that show one's image. */
type LibraryArtists = ReadonlyMap<number, ArtistRow>;

/** DJ on screen: Core's state, and the Library's artists its tiles show and open. */
interface Opened {
  readonly state: DjState;
  readonly artists: LibraryArtists;
  readonly library: MixIndexes["artists"];
}

/**
 * The "Fans might also like" list of [name]'s YouTube Music page, for the row
 * their tile opened (`readDjSimilar`). A page that's asked for is read and
 * saved under the artist's name as a Library album's page reads it
 * (`fetchArtist`, the page alone), so it feeds the artist graph. Only the
 * name and the artist's browse id are sent.
 */
const similarOf = (name: string) =>
  readDjSimilar({
    saved: () => appRuntime.runPromise(savedYtArtist(name)),
    canAsk: () => ytMusicEnabled() && online(),
    ask: (saved) =>
      appRuntime.runPromise(fetchArtist(name, identityKey(name), saved, { allSongs: false })),
    now: Date.now,
  });

/** DJ as it opens: the grid Core builds from [library], the last taste profile and artist graph. */
const openedOver = (library: MixIndexes): Opened => ({
  state: djOpened(
    djGrid({
      artists: library.artists,
      taste: latestTasteProfile(),
      played: library.topArtists,
      graph: recommendationSnapshot.peek().graph,
    }),
  ),
  artists: new Map(library.artists.map((artist) => [artist.id, artist])),
  library: library.artists,
});

/**
 * DJ's grid, drawn once per opening from what the phone already has: no
 * derivation and no request is waited for. Only a snapshot whose Library
 * part was never read (DJ opened before Home's mixes asked for it) is read
 * first, from the local database; null until then. A tile selected for the
 * first time opens its similar artists from the last artist graph; a row
 * that isn't full reads the artist's page once (Core's `djPagesNeeded`), and
 * whatever comes of it settles the row.
 */
const useDjGrid = () => {
  const [opened, setOpened] = useState<Opened | null>(() => {
    const { library } = recommendationSnapshot.peek();
    return library === null ? null : openedOver(library);
  });
  const waiting = opened === null;
  useEffect(() => {
    if (!waiting) return;
    let current = true;
    void appRuntime
      .runPromise(recommendationSnapshot.library)
      .then((library) => {
        if (current) setOpened(openedOver(library));
      })
      .catch(() => {
        if (current) setOpened({ state: djOpened([]), artists: new Map(), library: [] });
      });
    return () => {
      current = false;
    };
  }, [waiting]);
  const toggle = (key: DjTileKey): void =>
    setOpened(
      (current) =>
        current && {
          ...current,
          state: djReduce(current.state, {
            type: "toggle",
            key,
            graph: recommendationSnapshot.peek().graph,
            library: current.library,
          }),
        },
    );
  const asked = useRef(new Set<DjTileKey>());
  const state = opened?.state;
  useEffect(() => {
    if (state === undefined) return;
    for (const tile of djPagesNeeded(state)) {
      if (asked.current.has(tile.key)) continue;
      asked.current.add(tile.key);
      const settle = (artists: Awaited<ReturnType<typeof similarOf>>): void =>
        setOpened(
          (current) =>
            current && {
              ...current,
              state: djReduce(current.state, {
                type: "similar",
                key: tile.key,
                artists,
                library: current.library,
              }),
            },
        );
      void similarOf(tile.name).then(settle, () => settle(null));
    }
  }, [state]);
  return { opened, toggle };
};

/**
 * An artist tile: a circle with the artist's image, the name under it, and a
 * check over the circle once selected. A screen reader hears its kind, its
 * name and whether it's selected. A tile the seed has no room for is dimmed.
 */
function ArtistTile({
  tile,
  artist,
  size,
  selected,
  selectable,
  onPress,
}: {
  tile: DjArtistTile;
  artist: ArtistRow | undefined;
  size: number;
  selected: boolean;
  selectable: boolean;
  onPress: () => void;
}) {
  const { strings } = useLocalisation();
  const { image } = usePlayedArtist(
    artist ?? { id: tile.key, online: true, name: tile.name, thumbPath: null, artworkPath: null },
  );
  return (
    <View
      style={{ opacity: selectable ? 1 : 0.4 }}
      pointerEvents={selectable ? "auto" : "none"}
      accessibilityState={{ disabled: !selectable }}
    >
      <CardTile
        width={size}
        label={strings.dj.artistTile(tile.name)}
        checked={selected}
        onPress={onPress}
      >
        <View style={{ width: size, height: size }}>
          <ArtistImage artist={image} size={size} large />
          {selected && <TileCheck checked />}
        </View>
        <View style={{ paddingTop: CELL }}>
          <CardTitle centred>{tile.name}</CardTitle>
        </View>
      </CardTile>
    </View>
  );
}

/**
 * The place a row holds while its artist's page loads: a still circle and a
 * title bar, as large as an artist tile, so the grid doesn't jump when the
 * page arrives. Screen readers skip it.
 */
function PlaceholderTile({ size, fontScale }: { size: number; fontScale: number }) {
  return (
    <View
      style={{ width: size }}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <View className="bg-fill" style={{ width: size, height: size, borderRadius: size / 2 }} />
      <View className="items-center" style={{ paddingTop: CELL }}>
        <SkeletonLine lineHeight={titleLineHeight(fontScale)} width="60%" />
      </View>
    </View>
  );
}

/**
 * DJ (docs/spec.md, DJ): the owner picks the artists a Magic Queue starts
 * from. A tap selects or unselects a tile, and a tile selected for the first
 * time opens up to 3 similar artists right after it; Done reads the session's
 * first batch and plays it, then closes; Close leaves the queue as it is.
 * Adjust, beside Done, shows the Adjust screen in the grid's place: its back
 * arrow (and Android's Back) returns to the grid, which stayed as it was, and
 * Done starts the queue from either with the choices made there.
 */
export function DjScreen() {
  const { strings } = useLocalisation();
  const insets = useSafeAreaInsets();
  const { width, fontScale } = useWindowDimensions();
  const onAccent = useThemeColor("on-accent");
  const [available, setAvailable] = useState(width - grid.margin * 2);
  const { size } = magicQueueGrid(available, fontScale);
  const { opened, toggle } = useDjGrid();
  const [done, setDone] = useState<DjDone>("idle");
  const [settings, setSettings] = useState(DEFAULT_DJ_SETTINGS);
  const [adjusting, setAdjusting] = useState(false);
  useEffect(() => {
    if (!adjusting) return;
    return addScreenBackHandler(() => {
      setAdjusting(false);
      return true;
    });
  }, [adjusting]);
  useScreenContent(opened !== null);
  const state = opened?.state;
  const seed = useMemo(() => (state === undefined ? [] : djSeedTiles(state)), [state]);
  const cells = useMemo(() => (state === undefined ? [] : djCells(state)), [state]);
  const loading = done === "loading";
  const canStart = state !== undefined && djCanStart(state);
  const start = (): void =>
    void runDjDone(
      done,
      () => appRuntime.runPromise(startDjMagicQueue(seed, settings)),
      setDone,
      () => router.back(),
    );
  return (
    <View className="flex-1 bg-background" style={{ paddingTop: insets.top + 4 }}>
      <View style={{ paddingHorizontal: grid.margin - 12 }}>
        {adjusting ? (
          <IconButton
            icon={IconArrowLeft}
            label={strings.dj.backToGrid}
            onPress={() => setAdjusting(false)}
          />
        ) : (
          <IconButton icon={IconX} label={strings.dj.close} onPress={() => router.back()} />
        )}
      </View>
      {adjusting && (
        <DjAdjust
          settings={settings}
          onChange={(next) => {
            // The choices can't change while their first batch is read.
            if (loading) return;
            setDone("idle");
            setSettings(next);
          }}
        />
      )}
      <ScrollView
        // Kept under Adjust, so the grid is where it was left on the way back.
        style={adjusting ? { display: "none" } : undefined}
        contentContainerStyle={{ paddingHorizontal: grid.margin, paddingBottom: CELL * 3 }}
      >
        <Text
          accessibilityRole="header"
          className="font-sans text-title1 font-light text-foreground"
          style={{ paddingBottom: CELL * 2 }}
        >
          {strings.dj.title}
        </Text>
        <View onLayout={(event) => setAvailable(widthOf(event))}>
          {state !== undefined && state.tiles.length === 0 ? (
            <Text className="font-sans text-subheadline text-secondary">
              {strings.dj.nothingToPick}
            </Text>
          ) : (
            <View
              style={{
                width: available,
                flexDirection: "row",
                flexWrap: "wrap",
                columnGap: CELL,
                rowGap: CELL * 2,
              }}
            >
              {cells.map((cell) => {
                if (cell.kind === "placeholder" || state === undefined)
                  return <PlaceholderTile key={cell.key} size={size} fontScale={fontScale} />;
                const { tile } = cell;
                return (
                  <ArtistTile
                    key={cell.key}
                    tile={tile}
                    artist={
                      tile.libraryId === null ? undefined : opened?.artists.get(tile.libraryId)
                    }
                    size={size}
                    selected={djSelected(state, tile.key)}
                    // A selection can't change while its first batch is read.
                    selectable={!loading && djSelectable(state, tile.key)}
                    onPress={() => {
                      setDone("idle");
                      toggle(tile.key);
                    }}
                  />
                );
              })}
            </View>
          )}
        </View>
      </ScrollView>
      <View
        className="bg-background"
        style={{
          paddingHorizontal: grid.margin,
          paddingTop: CELL,
          paddingBottom: insets.bottom + CELL * 2,
          gap: CELL,
        }}
      >
        {(done === "failed" || done === "empty") && (
          <RecommendationsFailed
            onRetry={start}
            {...(done === "empty" ? { message: strings.dj.noSongsFound } : {})}
          />
        )}
        <View className="flex-row" style={{ gap: CELL }}>
          {!adjusting && (
            <TextButton
              variant="pill"
              tone="primary"
              label={strings.dj.adjust}
              disabled={loading}
              onPress={() => setAdjusting(true)}
              className="items-center"
              style={{ paddingHorizontal: CELL * 3 }}
            />
          )}
          <TextButton
            variant="pill"
            label={strings.dj.done}
            accessibilityLabel={loading ? strings.dj.starting : strings.dj.done}
            accessibilityState={{ selected: false, busy: loading }}
            selected={canStart}
            disabled={!canStart || loading}
            onPress={start}
            className="flex-1 flex-row items-center justify-center"
            style={{ gap: CELL }}
          >
            {(color) => (
              <>
                {loading && <ActivityIndicator size="small" color={onAccent} />}
                <Text
                  className="font-sans text-body font-semibold"
                  style={{ color: loading ? onAccent : color }}
                >
                  {strings.dj.done}
                </Text>
              </>
            )}
          </TextButton>
        </View>
      </View>
    </View>
  );
}
