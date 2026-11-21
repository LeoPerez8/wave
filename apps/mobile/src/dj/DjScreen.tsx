import {
  djCanStart,
  djGrid,
  djReduce,
  djReopened,
  djSeedTiles,
  djSelectable,
  djSelected,
  type DjArtistTile,
  type DjState,
  type DjTileKey,
} from "@wave/core";
import { IconArrowLeft, IconX } from "@tabler/icons-react-native";
import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, ScrollView, Text, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ArtistImage } from "@/catalog/ArtistImage";
import { CardTile, CardTitle } from "@/catalog/cards/CardParts";
import { TileCheck } from "@/catalog/CheckCell";
import { CELL, grid, widthOf } from "@/catalog/grid";
import { IconButton } from "@/components/IconButton";
import { RecommendationsFailed } from "@/components/RecommendationsFailed";
import { TextButton } from "@/components/TextButton";
import { magicQueueGrid } from "@/home/homeOpening";
import type { MixIndexes } from "@/home/mixKnown";
import { recommendationSnapshot } from "@/home/recommendationSnapshot";
import { useScreenContent } from "@/lib/screenTiming";
import { router } from "@/lib/timingRouter";
import { appRuntime } from "@/library/runtime";
import { useLocalisation } from "@/localisation/localisation";
import { addScreenBackHandler } from "@/overlay/back";
import { startDjMagicQueue } from "@/playback/MagicQueue";
import { latestTasteProfile } from "@/playback/TasteProfile";
import { usePlayedArtist } from "@/stats/PlayedEntityViews";
import { useThemeColor } from "@/theme/useThemeColor";
import type { ArtistRow } from "@wave/client";

import { DjAdjust } from "./DjAdjust";
import { runDjDone, type DjDone } from "./djDone";
import { djRemembered } from "./djRemembered";

/** The Library's artists by id, for the tiles that show one's image. */
type LibraryArtists = ReadonlyMap<number, ArtistRow>;

/**
 * DJ as it opens: the grid Core builds from [library], the last taste profile
 * and artist graph, with the tiles the last DJ was started from selected
 * (and in the grid, whether or not it would show them).
 */
const openedOver = (library: MixIndexes): { state: DjState; artists: LibraryArtists } => ({
  state: djReopened({
    grid: djGrid({
      artists: library.artists,
      taste: latestTasteProfile(),
      played: library.topArtists,
      graph: recommendationSnapshot.peek().graph,
    }),
    remembered: djRemembered.get().tiles,
    artists: library.artists,
  }),
  artists: new Map(library.artists.map((artist) => [artist.id, artist])),
});

/**
 * DJ's grid, drawn once per opening from what the phone already has: no
 * derivation and no request is waited for. Only a snapshot whose Library
 * part was never read (DJ opened before Home's mixes asked for it) is read
 * first, from the local database; null until then.
 */
const useDjGrid = () => {
  const [opened, setOpened] = useState(() => {
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
        if (current)
          setOpened({
            state: djReopened({ grid: [], remembered: djRemembered.get().tiles }),
            artists: new Map(),
          });
      });
    return () => {
      current = false;
    };
  }, [waiting]);
  const toggle = (key: DjTileKey): void =>
    setOpened(
      (current) =>
        current && { ...current, state: djReduce(current.state, { type: "toggle", key }) },
    );
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
 * DJ (docs/spec.md, DJ): the owner picks the artists a Magic Queue starts
 * from. A tap selects or unselects a tile; Done reads the session's first
 * batch and plays it, then closes; Close leaves the queue as it is. Adjust,
 * beside Done, shows the Adjust screen in the grid's place: its back arrow
 * (and Android's Back) returns to the grid, which stayed as it was, and Done
 * starts the queue from either with the choices made there. DJ opens with
 * the selection and the choices its last queue was started with, kept on
 * this phone (`djRemembered`); Done always starts a new session.
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
  const [settings, setSettings] = useState(() => djRemembered.get().settings);
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
  const loading = done === "loading";
  const canStart = state !== undefined && djCanStart(state);
  const start = (): void =>
    void runDjDone(
      done,
      () => appRuntime.runPromise(startDjMagicQueue(seed, settings)),
      setDone,
      () => {
        // The queue started: this DJ is the one the next opening shows.
        djRemembered.set({ tiles: seed, settings });
        router.back();
      },
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
              {state?.tiles.map((tile) => (
                <ArtistTile
                  key={tile.key}
                  tile={tile}
                  artist={tile.libraryId === null ? undefined : opened?.artists.get(tile.libraryId)}
                  size={size}
                  selected={djSelected(state, tile.key)}
                  // A selection can't change while its first batch is read.
                  selectable={!loading && djSelectable(state, tile.key)}
                  onPress={() => {
                    setDone("idle");
                    toggle(tile.key);
                  }}
                />
              ))}
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
