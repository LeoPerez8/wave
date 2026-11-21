import {
  ARTIST_MIX_COUNT,
  djCanStart,
  djCells,
  djOpened,
  djOpeningGrid,
  djPagesNeeded,
  djReduce,
  djReopened,
  djRestoredGrid,
  djSeedTiles,
  djSelectable,
  djSelected,
  djSettingsSummary,
  djNewToYou,
  type DjAlbumTile,
  type DjArtistTile,
  type DjGenreTile,
  type DjOpeningGrid,
  type DjSettings,
  type DjState,
  type DjTile,
  type DjTileKey,
  identityKey,
} from "@wave/core";
import {
  IconAdjustmentsHorizontal,
  IconArrowLeft,
  IconPlayerPlayFilled,
  IconSearch,
  IconX,
} from "@tabler/icons-react-native";
import {
  type ComponentRef,
  type ReactNode,
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { ActivityIndicator, ScrollView, Text, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ArtistImage } from "@/catalog/ArtistImage";
import { Artwork } from "@/catalog/Artwork";
import { CardDetail, CardTile, CardTitle, titleLineHeight } from "@/catalog/cards/CardParts";
import { CELL, grid, widthOf } from "@/catalog/grid";
import { SkeletonGroup } from "@/catalog/Skeletons";
import { SkeletonLine } from "@/catalog/SkeletonLine";
import { BACKDROP } from "@/chrome/chrome";
import { IconButton } from "@/components/IconButton";
import { RecommendationsFailed } from "@/components/RecommendationsFailed";
import { StagedSections } from "@/components/StagedSections";
import { TextButton } from "@/components/TextButton";
import { useBuiltArtistMixes } from "@/home/discoverMixes";
import { magicQueueGrid } from "@/home/homeOpening";
import type { MixIndexes } from "@/home/mixKnown";
import { recommendationSnapshot } from "@/home/recommendationSnapshot";
import { savedYtArtist } from "@/home/ytArtistPage";
import { useScreenContent } from "@/lib/screenTiming";
import { router } from "@/lib/timingRouter";
import { appRuntime } from "@/library/runtime";
import { useLocalisation } from "@/localisation/localisation";
import { Press } from "@/motion/Press";
import { addScreenBackHandler } from "@/overlay/back";
import { online } from "@/native/waveNative";
import { startDjMagicQueue } from "@/playback/MagicQueue";
import { latestTasteProfile } from "@/playback/TasteProfile";
import { ytMusicEnabled } from "@/settings/ytMusic";
import { usePlayedArtist } from "@/stats/PlayedEntityViews";
import { useThemeColor } from "@/theme/useThemeColor";
import { fetchArtist } from "@/ytmusic/artistSection";
import type { ArtistRow } from "@wave/client";

import { DjAdjustScrim, DjAdjustSheet, useDjAdjustSheet } from "./DjAdjust";
import { gridSources, preparedDjOpening, readDjOpening, type DjOpeningRead } from "./djOpening";
import { DjSearch } from "./DjSearch";
import { djDone, type DjDone, type DjDoneRunner } from "./djDone";
import { djRemembered } from "./djRemembered";
import { djGridMemory } from "./djGridMemory";
import { DJ_TILE_RADIUS, DjSelectionRow, DjTilePicture } from "./DjSelection";
import { readDjSimilar } from "./djSimilar";

/** The Library's artists by id, for the tiles that show one's image. */
type LibraryArtists = ReadonlyMap<number, ArtistRow>;

/** The Library part of the recommendation snapshot, or "failed" when it couldn't be read. */
type DjLibrary = MixIndexes | "failed" | null;

/** The Library's artists while its part of the snapshot isn't read, or couldn't be. */
const NO_ARTISTS: MixIndexes["artists"] = [];

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

/**
 * DJ's grid, drawn once per opening from what the phone already has: no
 * derivation and no request is waited for. Only a snapshot whose Library
 * part was never read (DJ opened before Home's mixes asked for it) is read
 * first, from the local database, and then the albums the grid may show
 * (`albumsOver`). Core chooses its source (`djOpeningGrid`):
 * the last taste profile and artist graph, or with no taste signal the chart
 * artists of the Artist mixes. [state] is null until the grid has tiles;
 * until then [opening] says what stands in their place (null while the
 * Library part is read). The tiles the last DJ was started from are selected
 * in it, and are in it whether or not it would show them (Core's
 * `djReopened`), a remembered album as the albums read here know it. The first tiles stay for the whole opening. A tile
 * selected for the first time, whichever source it came from, opens its
 * similar artists from the last artist graph; a row that isn't full reads the
 * artist's page once (Core's `djPagesNeeded`), one read at a time per
 * artist, and whatever comes of it settles every row waiting for it. A result of the grid's search joins the grid selected
 * ([add]), opening its row the same way; over a grid that has nothing to
 * pick, it's the first tile.
 */
const useDjGrid = () => {
  const artistMixes = useBuiltArtistMixes();
  const [keptGrid] = useState(() => djGridMemory.get());
  const [library, setLibrary] = useState<DjLibrary>(() =>
    keptGrid === null ? recommendationSnapshot.peek().library : "failed",
  );
  const [state, setState] = useState<DjState | null>(() =>
    keptGrid === null ? null : djRestoredGrid(keptGrid, djRemembered.get().tiles),
  );
  const waiting = library === null;
  useEffect(() => {
    if (keptGrid !== null) return;
    if (!waiting) return;
    let current = true;
    void appRuntime
      .runPromise(recommendationSnapshot.library)
      .then((read) => {
        if (current) setLibrary(read);
      })
      .catch(() => {
        if (current) setLibrary("failed");
      });
    return () => {
      current = false;
    };
  }, [waiting, keptGrid]);
  // The Library snapshot's families and albums, read once per snapshot outside render; the
  // one startup prepared opens DJ on its tiles (`djOpening.ts`, #1352).
  const [read, setRead] = useState<DjOpeningRead | null>(() =>
    library === null || library === "failed" ? null : preparedDjOpening(library),
  );
  useEffect(() => {
    if (keptGrid !== null) return;
    if (library === null || library === "failed") return;
    let current = true;
    void readDjOpening(library).then((opening) => {
      if (current) setRead(opening);
    });
    return () => {
      current = false;
    };
  }, [library, keptGrid]);
  const ready = read !== null && read.library === library ? read : null;
  const opening = useMemo((): DjOpeningGrid | null => {
    if (library === null) return null;
    if (library === "failed") return { kind: "nothing" };
    if (ready === null) return null;
    return djOpeningGrid({
      ...gridSources(ready.library, ready.families),
      albums: ready.albums,
      artistMixes,
    });
  }, [library, ready, artistMixes]);
  const libraryArtists = library === null || library === "failed" ? NO_ARTISTS : library.artists;
  if (state === null && opening !== null && opening.kind !== "skeleton") {
    // The tiles the last DJ was started from are selected, and in the grid
    // even when it has nothing else to show.
    const reopened = djReopened({
      grid: opening.kind === "tiles" ? opening.tiles : [],
      remembered: djRemembered.get().tiles,
      artists: libraryArtists,
      albums: ready?.albums ?? [],
      genreCandidates: ready?.families ?? null,
      taste: latestTasteProfile(),
    });
    if (reopened.tiles.length > 0) setState(reopened);
  }
  const skipInitialGridWrite = useRef(keptGrid !== null);
  useEffect(() => {
    if (skipInitialGridWrite.current) {
      skipInitialGridWrite.current = false;
      return;
    }
    if (state !== null) djGridMemory.set(state.tiles);
  }, [state]);
  const artists = useMemo(
    (): LibraryArtists => new Map(libraryArtists.map((artist) => [artist.id, artist])),
    [libraryArtists],
  );
  const toggle = useCallback(
    (key: DjTileKey): void =>
      setState(
        (current) =>
          current &&
          djReduce(current, {
            type: "toggle",
            key,
            graph: recommendationSnapshot.peek().graph,
            library: libraryArtists,
          }),
      ),
    [libraryArtists],
  );
  const add = (tile: DjTile): void =>
    setState((current) =>
      djReduce(current ?? djOpened([]), {
        type: "add",
        tile,
        graph: recommendationSnapshot.peek().graph,
        library: libraryArtists,
      }),
    );
  // The artists whose page is being read, by `identityKey`: one read at a time per artist.
  const asked = useRef(new Set<string>());
  const skipInitialPages = useRef(keptGrid !== null);
  useEffect(() => {
    if (state === null) return;
    if (skipInitialPages.current) {
      skipInitialPages.current = false;
      return;
    }
    for (const page of djPagesNeeded(state)) {
      if (asked.current.has(page.key)) continue;
      asked.current.add(page.key);
      const settle = (similar: Awaited<ReturnType<typeof similarOf>>): void => {
        asked.current.delete(page.key);
        setState(
          (current) =>
            current &&
            djReduce(current, {
              type: "similar",
              artist: page.artist,
              artists: similar,
              library: libraryArtists,
            }),
        );
      };
      void similarOf(page.artist).then(settle, () => settle(null));
    }
  }, [state, libraryArtists]);
  const visibleOpening = state === null ? opening : { kind: "tiles" as const, tiles: state.tiles };
  return { state, opening: visibleOpening, artists, toggle, add };
};

/**
 * The grid while the chart-seeded Artist mixes build: still placeholder
 * tiles in the artist tiles' shape, one for each mix to come. A screen
 * reader hears one busy element.
 */
function TilesSkeleton({ size, fontScale }: { size: number; fontScale: number }) {
  const { strings } = useLocalisation();
  return (
    <SkeletonGroup label={strings.dj.loadingArtists}>
      <View style={{ flexDirection: "row", flexWrap: "wrap", columnGap: CELL, rowGap: CELL * 2 }}>
        {Array.from({ length: ARTIST_MIX_COUNT }, (_, index) => (
          <View key={index} style={{ width: size, alignItems: "center" }}>
            <View
              className="bg-fill"
              style={{ width: size, height: size, borderRadius: size / 2 }}
            />
            <View style={{ paddingTop: CELL, width: size, alignItems: "center" }}>
              <SkeletonLine lineHeight={22 * Math.max(1, fontScale)} width="70%" />
            </View>
          </View>
        ))}
      </View>
    </SkeletonGroup>
  );
}

/**
 * A tile's card, [label] to a screen reader, checked once [selected]; dimmed and out of reach
 * while not [selectable], when the seed has no room for it.
 */
function SelectableTile({
  size,
  label,
  selected,
  selectable,
  onPress,
  children,
}: {
  size: number;
  label: string;
  selected: boolean;
  selectable: boolean;
  onPress: () => void;
  children: ReactNode;
}) {
  return (
    <View
      style={{ opacity: selectable ? 1 : 0.4 }}
      pointerEvents={selectable ? "auto" : "none"}
      accessibilityState={{ disabled: !selectable }}
    >
      <CardTile width={size} label={label} checked={selected} onPress={onPress}>
        {children}
      </CardTile>
    </View>
  );
}

/**
 * An artist tile: a circle with the artist's image and the name under it,
 * with "New to you" under the name for an artist the Library doesn't have
 * (Core's `djNewToYou`). Once selected, the circle is ringed and checked
 * (`DjTilePicture`). A screen reader hears its kind, its name and whether
 * it's selected. A tile the seed has no room for is dimmed.
 * Memoized with a stable `onToggle`, so a tap redraws the tiles it changes.
 */
const ArtistTile = memo(function ArtistTile({
  tile,
  artist,
  size,
  selected,
  selectable,
  onToggle,
}: {
  tile: DjArtistTile;
  artist: ArtistRow | undefined;
  size: number;
  selected: boolean;
  selectable: boolean;
  onToggle: (key: DjTileKey) => void;
}) {
  const { strings } = useLocalisation();
  const { image } = usePlayedArtist(
    artist ?? { id: tile.key, online: true, name: tile.name, thumbPath: null, artworkPath: null },
  );
  return (
    <SelectableTile
      size={size}
      label={strings.dj.artistTile(tile.name)}
      selected={selected}
      selectable={selectable}
      onPress={() => onToggle(tile.key)}
    >
      <DjTilePicture
        size={size}
        round
        selected={selected}
        picture={(inner) => <ArtistImage artist={image} size={inner} large />}
      />
      <View className="items-center" style={{ paddingTop: CELL }}>
        <CardTitle centred>{tile.name}</CardTitle>
        {djNewToYou(tile) && <CardDetail size="footnote">{strings.dj.newToYou}</CardDetail>}
      </View>
    </SelectableTile>
  );
});

/**
 * An album tile: a square cover and the album's title and artist under it;
 * once selected, the cover is ringed and checked (`DjTilePicture`). A screen reader hears its kind, its
 * title and artist and whether it's selected. A tile the seed has no room
 * for is dimmed.
 */
const AlbumTile = memo(function AlbumTile({
  tile,
  size,
  selected,
  selectable,
  onToggle,
}: {
  tile: DjAlbumTile;
  size: number;
  selected: boolean;
  selectable: boolean;
  onToggle: (key: DjTileKey) => void;
}) {
  const { strings } = useLocalisation();
  return (
    <SelectableTile
      size={size}
      label={strings.dj.albumTile(tile.name, tile.artist)}
      selected={selected}
      selectable={selectable}
      onPress={() => onToggle(tile.key)}
    >
      <DjTilePicture
        size={size}
        round={false}
        selected={selected}
        picture={(inner) => (
          <Artwork uri={tile.cover ?? undefined} size={inner} radius={DJ_TILE_RADIUS} />
        )}
      />
      <View style={{ paddingTop: CELL }}>
        <CardTitle>{tile.name}</CardTitle>
        <CardDetail size="footnote">{tile.artist}</CardDetail>
      </View>
    </SelectableTile>
  );
});

/** A family tile: a square named for its family, ringed and checked once selected. */
const GenreTile = memo(function GenreTile({
  tile,
  size,
  selected,
  selectable,
  onToggle,
}: {
  tile: DjGenreTile;
  size: number;
  selected: boolean;
  selectable: boolean;
  onToggle: (key: DjTileKey) => void;
}) {
  const { strings } = useLocalisation();
  return (
    <SelectableTile
      size={size}
      label={strings.dj.genreTile(tile.name)}
      selected={selected}
      selectable={selectable}
      onPress={() => onToggle(tile.key)}
    >
      <DjTilePicture
        size={size}
        round={false}
        selected={selected}
        picture={(inner) => (
          <View
            className="bg-fill items-center justify-center"
            style={{
              width: inner,
              height: inner,
              borderRadius: DJ_TILE_RADIUS,
              padding: CELL * 2,
            }}
          >
            <CardTitle centred>{tile.name}</CardTitle>
          </View>
        )}
      />
    </SelectableTile>
  );
});

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
 * DJ (docs/spec.md, DJ): the owner picks the artists and albums a Magic
 * Queue starts from. DJ opens with the selection and the choices its last
 * queue was started with, kept on this phone (`djRemembered`). A tap selects
 * or unselects a tile, and a tile selected for the first time in an opening
 * opens up to 3 tiles right after it (an artist's similar artists; an
 * album's artist, then theirs). The Your selection row under the title
 * shows the selected tiles in selection order, a tap on one unselecting it
 * (`DjSelectionRow`). Play ("Play · 3", counting the selection) reads a new
 * session's first batch and plays it, then closes; Close leaves the queue as
 * it is. Over Play, the summary of the Adjust choices (Core's
 * `djSettingsSummary`) and the adjustments icon open the Adjust sheet over
 * the grid, dimmed behind a scrim (`DjAdjustSheet`): Android's Back, a tap
 * on the scrim or a swipe down on its handle closes it over the grid as it
 * was left, and the sheet's own Play starts the queue as the bar's does,
 * with the choices made there. The search
 * button beside Close shows the search in the grid's place (`DjSearch`): a
 * tapped result joins the grid selected and the grid comes back, at its top
 * when the result is a new first tile.
 */
export function DjScreen() {
  const { strings } = useLocalisation();
  const insets = useSafeAreaInsets();
  const { width, fontScale } = useWindowDimensions();
  const [onAccent, accent] = useThemeColor(["on-accent", "accent"]);
  const [available, setAvailable] = useState(width - grid.margin * 2);
  const { size } = magicQueueGrid(available, fontScale);
  const { state: picked, opening, artists, toggle, add } = useDjGrid();
  const [done, setDone] = useState<DjDone>("idle");
  const [settings, setSettings] = useState(() => djRemembered.get().settings);
  const [adjusting, setAdjusting] = useState(false);
  const [searching, setSearching] = useState(false);
  const sheet = useDjAdjustSheet(adjusting);
  const gridScroll = useRef<ComponentRef<typeof ScrollView>>(null);
  useEffect(() => {
    if (!adjusting && !searching) return;
    return addScreenBackHandler(() => {
      // The sheet opens over the grid, never over the search: Back closes whichever shows.
      if (adjusting) setAdjusting(false);
      else setSearching(false);
      return true;
    });
  }, [adjusting, searching]);
  useScreenContent(opening !== null);
  const state = picked ?? undefined;
  const seed = useMemo(() => (state === undefined ? [] : djSeedTiles(state)), [state]);
  // Keep the visit's selection and choices so closing DJ and reopening it restores the same view.
  useEffect(() => {
    if (state !== undefined) djRemembered.set({ tiles: seed, settings });
  }, [state, seed, settings]);
  const cells = useMemo(() => (state === undefined ? [] : djCells(state)), [state]);
  const loading = done === "loading";
  // One stable handler for every tile, so a tap redraws only the tiles whose selection changed.
  const onToggle = useCallback(
    (key: DjTileKey): void => {
      setDone("idle");
      toggle(key);
    },
    [toggle],
  );
  // A tile's row, over the tiles a row holds, for mounting the grid a screen at a time.
  const perRow = Math.max(1, Math.floor((available + CELL) / (size + CELL)));
  const cellEstimate = (size + CELL + titleLineHeight(fontScale) + CELL * 2) / perRow;
  const canStart = state !== undefined && djCanStart(state);
  const play = seed.length > 0 ? strings.dj.playCount(seed.length) : strings.dj.play;
  const summary = djSettingsSummary(settings, strings);
  // Play for this opening; leaving DJ (Close, Android's Back) cancels a start
  // still loading, so it never replaces the queue nor closes another screen.
  const doneRunner = useRef<DjDoneRunner | null>(null);
  useEffect(() => {
    const runner = djDone(setDone, () => router.back());
    doneRunner.current = runner;
    return () => {
      runner.cancel();
      doneRunner.current = null;
    };
  }, []);
  const start = (): void =>
    void doneRunner.current?.run(async (closed) => {
      const outcome = await appRuntime.runPromise(startDjMagicQueue(seed, settings, closed), {
        signal: closed,
      });
      // The queue started: this DJ is the one the next opening shows.
      if (outcome === "started") djRemembered.set({ tiles: seed, settings });
      return outcome;
    });
  // The failure line, over the Play that was tapped: the bar's, or the sheet's while it's up.
  const failed = (done === "failed" || done === "empty") && (
    <RecommendationsFailed
      onRetry={start}
      {...(done === "empty" ? { message: strings.dj.noSongsFound } : {})}
    />
  );
  // The bar's Play and the sheet's: one pill, one start.
  const playPill = (
    <TextButton
      variant="pill"
      label={play}
      accessibilityLabel={loading ? strings.dj.starting : play}
      accessibilityState={{ selected: false, busy: loading }}
      selected={canStart}
      disabled={!canStart || loading}
      onPress={start}
      className="flex-row items-center justify-center"
      style={{ gap: CELL }}
    >
      {(color) => (
        <>
          {loading ? (
            <ActivityIndicator size="small" color={onAccent} />
          ) : (
            <IconPlayerPlayFilled size={CELL * 2.5} color={color} />
          )}
          <Text
            className="font-sans text-body font-semibold"
            style={{ color: loading ? onAccent : color }}
          >
            {play}
          </Text>
        </>
      )}
    </TextButton>
  );
  const changeSettings = (next: DjSettings): void => {
    // The choices can't change while their first batch is read.
    if (loading) return;
    setDone("idle");
    setSettings(next);
  };
  return (
    <View className="flex-1 bg-background">
      <View
        // What the Adjust sheet's glass shows through, its scrim drawn last.
        nativeID={BACKDROP.dj}
        collapsable={false}
        className="flex-1 bg-background"
        style={{ paddingTop: insets.top + 4 }}
      >
        <View
          className="flex-1"
          // Screen readers stay in the sheet while it's up.
          importantForAccessibility={adjusting ? "no-hide-descendants" : "auto"}
          accessibilityElementsHidden={adjusting}
        >
          <View
            className="flex-row justify-between"
            style={{ paddingHorizontal: grid.margin - 12 }}
          >
            {searching ? (
              <IconButton
                icon={IconArrowLeft}
                label={strings.dj.backToGrid}
                onPress={() => setSearching(false)}
              />
            ) : (
              <IconButton icon={IconX} label={strings.dj.close} onPress={() => router.back()} />
            )}
            {/* With the grid, or over one with nothing to pick; not while placeholders stand for it. */}
            {!searching && (state !== undefined || opening?.kind === "nothing") && (
              <IconButton
                icon={IconSearch}
                label={strings.dj.search}
                disabled={loading}
                onPress={() => setSearching(true)}
              />
            )}
          </View>
          {searching && (
            <DjSearch
              state={state}
              onPick={(tile) => {
                // A result the grid lacks becomes its first tile: the grid comes back there.
                if (state?.tiles.every((each) => each.key !== tile.key) ?? true)
                  gridScroll.current?.scrollTo({ y: 0, animated: false });
                setDone("idle");
                add(tile);
                setSearching(false);
              }}
            />
          )}
          <ScrollView
            ref={gridScroll}
            // Kept under the search, so the grid is where it was left on the way back.
            style={searching ? { display: "none" } : undefined}
            contentContainerStyle={{ paddingHorizontal: grid.margin, paddingBottom: CELL * 3 }}
          >
            <Text
              accessibilityRole="header"
              className="font-sans text-title1 font-light text-foreground"
              style={{ paddingBottom: CELL * 2 }}
            >
              {strings.dj.title}
            </Text>
            {state !== undefined && (
              <View style={{ paddingBottom: CELL * 3 }}>
                <DjSelectionRow
                  tiles={seed}
                  artists={artists}
                  // A selection can't change while its first batch is read.
                  disabled={loading}
                  onRemove={(key) => {
                    setDone("idle");
                    toggle(key);
                  }}
                />
              </View>
            )}
            <View onLayout={(event) => setAvailable(widthOf(event))}>
              {state === undefined && opening?.kind === "skeleton" ? (
                <TilesSkeleton size={size} fontScale={fontScale} />
              ) : state === undefined && opening?.kind === "nothing" ? (
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
                  <StagedSections estimate={cellEstimate}>
                    {cells.map((cell) => {
                      if (cell.kind === "placeholder" || state === undefined)
                        return <PlaceholderTile key={cell.key} size={size} fontScale={fontScale} />;
                      const { tile } = cell;
                      const picking = {
                        size,
                        selected: djSelected(state, tile.key),
                        // A selection can't change while its first batch is read.
                        selectable: !loading && djSelectable(state, tile.key),
                        onToggle,
                      };
                      return tile.kind === "album" ? (
                        <AlbumTile key={cell.key} tile={tile} {...picking} />
                      ) : tile.kind === "genre" ? (
                        <GenreTile key={cell.key} tile={tile} {...picking} />
                      ) : (
                        <ArtistTile
                          key={cell.key}
                          tile={tile}
                          artist={tile.libraryId === null ? undefined : artists.get(tile.libraryId)}
                          {...picking}
                        />
                      );
                    })}
                  </StagedSections>
                </View>
              )}
            </View>
          </ScrollView>
          <View
            className="bg-background"
            style={{
              // The search has the screen to itself, above the keyboard.
              display: searching ? "none" : "flex",
              paddingHorizontal: grid.margin,
              paddingTop: CELL,
              paddingBottom: insets.bottom + CELL * 2,
              gap: CELL,
            }}
          >
            {!adjusting && failed}
            <Press
              accessibilityRole="button"
              accessibilityLabel={strings.dj.adjustSummary(summary)}
              accessibilityState={{ disabled: loading }}
              disabled={loading}
              onPress={() => setAdjusting(true)}
              className="flex-row items-center justify-between"
              style={{ paddingLeft: CELL, marginRight: -CELL * 1.5, opacity: loading ? 0.4 : 1 }}
            >
              <Text numberOfLines={1} className="flex-1 font-sans text-footnote text-secondary">
                {summary}
              </Text>
              <View
                className="items-center justify-center"
                style={{ width: CELL * 6, height: CELL * 6 }}
              >
                <IconAdjustmentsHorizontal size={CELL * 3} color={accent} strokeWidth={1.5} />
              </View>
            </Press>
            {playPill}
          </View>
        </View>
        <DjAdjustScrim sheet={sheet} onClose={() => setAdjusting(false)} />
      </View>
      <DjAdjustSheet
        sheet={sheet}
        settings={settings}
        disabled={loading}
        onChange={changeSettings}
        onClose={() => setAdjusting(false)}
      >
        {adjusting && failed}
        {playPill}
      </DjAdjustSheet>
    </View>
  );
}
