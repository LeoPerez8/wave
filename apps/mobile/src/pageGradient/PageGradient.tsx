import {
  PAGE_TOP_FADE,
  pageGradientPalette,
  parseTrackId,
  type ArtworkPalette,
  type PageCover,
} from "@wave/core";
import * as Effect from "effect/Effect";
import { useEffect, useSyncExternalStore, type ReactElement, type ReactNode } from "react";
import { StyleSheet, useWindowDimensions } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue } from "react-native-reanimated";

import { ClearRowsContext } from "@/catalog/SwipeableRow";
import { LibraryStore } from "@/library/LibraryStore";
import { appRuntime } from "@/library/runtime";
import { screenCostLayout } from "@/lib/renderCost";
import { Background, useBackgroundColors } from "@/nowPlaying/Background";
import { useThemedGround } from "@/nowPlaying/hooks";
import { useCurrentTrackId } from "@/playback/hooks";
import { queueTracks } from "@/playback/queueTracks";
import { usePageGradient } from "@/settings/pageGradient";

import { PageScroll, usePageScroll } from "./pageScroll";

/**
 * The page-top gradient (Settings › Appearance › Colour at the Top of Pages, #1472): a subtle
 * tint from the page's cover, or the playing song's, fading into the ground at the top of a
 * page (Core's `PAGE_TOP_FADE`), drawn with plain views as Now Playing's ground is.
 *
 * Each screen gets a `PageGradientScope` (from its stack's `pageScreenLayout`, or the tab
 * renderer): it carries the page's main list scroll, which `useListScroll` writes, so the
 * tint scrolls away with the content, and while the option is on it clears the song rows'
 * own ground (`ClearRowsContext`) so the tint shows behind them.
 */
export function PageGradientScope({ children }: { children: ReactNode }) {
  const scroll = useSharedValue(0);
  const on = usePageGradient();
  return (
    <PageScroll value={scroll}>
      <ClearRowsContext value={on}>{children}</ClearRowsContext>
    </PageScroll>
  );
}

/** A stack's `screenLayout`: each screen's render cost (`screenCostLayout`) in its own scope. */
export const pageScreenLayout = (props: {
  route: { name: string };
  children: ReactElement;
}): ReactElement => <PageGradientScope>{screenCostLayout(props)}</PageGradientScope>;

// The playing Library song's cover colours, read once per song for every page showing them.
const libraryPalettes = new Map<number, ArtworkPalette | null>();
const loading = new Set<number>();
const paletteListeners = new Set<() => void>();
const subscribePalettes = (listener: () => void) => {
  paletteListeners.add(listener);
  return () => void paletteListeners.delete(listener);
};
/** Songs whose colours are kept: the playing one and the few before it. */
const KEPT_PALETTES = 8;

const loadLibraryPalette = (id: number): void => {
  if (libraryPalettes.has(id) || loading.has(id)) return;
  loading.add(id);
  const keep = (palette: ArtworkPalette | null) => {
    loading.delete(id);
    libraryPalettes.set(id, palette);
    for (const old of libraryPalettes.keys()) {
      if (libraryPalettes.size <= KEPT_PALETTES) break;
      if (old !== id) libraryPalettes.delete(old);
    }
    for (const listener of paletteListeners) listener();
  };
  appRuntime
    .runPromise(
      Effect.gen(function* () {
        const store = yield* LibraryStore;
        return yield* store.trackDetails(id);
      }),
    )
    .then(
      (details) => keep(details?.palette ?? null),
      () => keep(null),
    );
};

/**
 * The playing song's cover colours: a Library song's from the library, a YT Music song's as
 * the queue learned them. Null when nothing plays or its colours aren't known yet.
 */
const usePlayingPalette = (): ArtworkPalette | null => {
  const trackId = useCurrentTrackId();
  const track = trackId === null ? null : parseTrackId(trackId);
  const libraryId = track?.kind === "library" ? track.id : null;
  useEffect(() => {
    if (libraryId !== null) loadLibraryPalette(libraryId);
  }, [libraryId]);
  const library = useSyncExternalStore(subscribePalettes, () =>
    libraryId === null ? null : (libraryPalettes.get(libraryId) ?? null),
  );
  const streamed = useSyncExternalStore(queueTracks.subscribe, () =>
    trackId === null || libraryId !== null
      ? null
      : (queueTracks.get().get(trackId)?.palette ?? null),
  );
  return libraryId === null ? streamed : library;
};

// Cover colours by artwork path, as read for album, playlist and artist pages.
const coverPalettes = new Map<string, ArtworkPalette | null>();
const coversLoading = new Set<string>();
const coverListeners = new Set<() => void>();
const subscribeCovers = (listener: () => void) => {
  coverListeners.add(listener);
  return () => void coverListeners.delete(listener);
};
/** Covers whose colours are kept, for going back and forth between a few pages. */
const KEPT_COVERS = 32;

const loadCoverPalette = (path: string): void => {
  if (coverPalettes.has(path) || coversLoading.has(path)) return;
  coversLoading.add(path);
  const keep = (palette: ArtworkPalette | null) => {
    coversLoading.delete(path);
    coverPalettes.set(path, palette);
    for (const old of coverPalettes.keys()) {
      if (coverPalettes.size <= KEPT_COVERS) break;
      if (old !== path) coverPalettes.delete(old);
    }
    for (const listener of coverListeners) listener();
  };
  appRuntime
    .runPromise(
      Effect.gen(function* () {
        const store = yield* LibraryStore;
        return yield* store.artworkPalette(path);
      }),
    )
    .then(keep, () => keep(null));
};

/**
 * Where a page's colours come from: omitted for a page without a cover of its own (it takes
 * the playing song's); "loading" while its cover isn't known yet; its cover's artwork path,
 * or null when it has none.
 */
export type PageCoverSource = undefined | "loading" | string | null;

const usePageCover = (source: PageCoverSource): PageCover => {
  const path = typeof source === "string" && source !== "loading" ? source : null;
  useEffect(() => {
    if (path !== null) loadCoverPalette(path);
  }, [path]);
  const known = useSyncExternalStore(subscribeCovers, () =>
    path === null ? undefined : coverPalettes.get(path),
  );
  if (source === undefined) return null;
  if (source === "loading") return "loading";
  if (source === null) return { palette: null };
  return known === undefined ? "loading" : { palette: known };
};

/**
 * The page-top gradient, drawn behind the page's content while the option is on: put it
 * first in the page's root, above whose ground it draws. It moves up with the scope's list
 * as it scrolls; [inScroll] places it inside the scrolling content itself (a large title
 * screen), where it moves with it natively. Song changes crossfade (`useBackgroundColors`).
 */
export function PageTopGradient({
  cover,
  inScroll = false,
}: {
  cover?: PageCoverSource;
  inScroll?: boolean;
}) {
  return usePageGradient() ? <PageTopGradientLayer cover={cover} inScroll={inScroll} /> : null;
}

function PageTopGradientLayer({ cover, inScroll }: { cover: PageCoverSource; inScroll: boolean }) {
  const { height } = useWindowDimensions();
  const scroll = usePageScroll();
  const pageCover = usePageCover(cover);
  const playing = usePlayingPalette();
  const palette = pageGradientPalette(pageCover, playing);
  const colors = useBackgroundColors(useThemedGround(palette, PAGE_TOP_FADE), true);
  const moves = !inScroll && scroll !== null;
  const style = useAnimatedStyle(() => ({
    transform: [{ translateY: moves && scroll !== null ? -Math.max(0, scroll.get()) : 0 }],
  }));
  return (
    <Animated.View style={[styles.layer, { height }, style]} pointerEvents="none">
      <Background colors={colors} />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  layer: { position: "absolute", top: 0, left: 0, right: 0 },
});
