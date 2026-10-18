import { IconQuoteOff, IconShare3 } from "@tabler/icons-react-native";
import {
  MAX_SHARED_LYRIC_LINES,
  currentLyricIndex,
  isLyricLineSelected,
  lyricCardColours,
  shareableLyricLines,
  sharedLyricLines,
  tapLyricLine,
  withOpacity,
  type ArtworkPalette,
  type LyricLine,
  type LyricSelection,
} from "@wave/core";
import * as Haptics from "expo-haptics";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ScrollView, Text, View, type ScrollViewInstance } from "react-native";
import Animated, {
  interpolateColor,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";

import { CELL, grid } from "@/catalog/grid";
import { SkeletonLine } from "@/catalog/SkeletonLine";
import { EmptyState } from "@/components/EmptyState";
import { IconButton } from "@/components/IconButton";
import { TextButton } from "@/components/TextButton";
import { Press } from "@/motion/Press";
import { addScreenBackHandler } from "@/overlay/back";
import { seekTo } from "@/playback/actions";
import type { PlaybackState } from "@/playback/Player";
import { closeLyricCard, openLyricCard } from "@/share/lyricCard";
import { useThemeColor } from "@/theme/useThemeColor";

import { DismissArea } from "./DismissArea";
import { usePlayhead, type LibraryFile } from "./hooks";
import { TrackHeader } from "./TrackHeader";
import { useLibraryLyrics, type LibraryLyricsShown } from "./useLibraryLyrics";
import { useNonDLyrics, type NonDLyricsShown } from "./useNonDLyrics";

/** Where the sung line rests, as a fraction of the view's height from its top. */
const ANCHOR = 0.3;
/** How long after the finger leaves the lyrics they start following the song again. */
const RESUME_FOLLOW_MS = 3000;
/** The sung line's tint eases in over this long. */
const HIGHLIGHT_MS = 240;

/**
 * Room either side of a line for its selected backdrop, taken back by a
 * negative margin so the words stay where they were.
 */
const LINE_INSET = {
  marginHorizontal: -CELL,
  paddingHorizontal: CELL,
  borderRadius: CELL,
} as const;

/** While Share picks lines: whether each shows as selected, and what a tap on one does. */
interface Picking {
  readonly isSelected: (index: number) => boolean;
  readonly onTap: (index: number) => void;
}

/** The backdrop of a selected line: the ink, faint. */
const useSelectedFill = (): string => withOpacity(useThemeColor("foreground"), 0.12);

/** The square dots standing in for a pause between sung lines. */
function PauseDots({ current }: { current: boolean }) {
  return (
    <View className="flex-row items-center" style={{ height: CELL * 3, gap: CELL }}>
      {[0, 1, 2].map((dot) => (
        <View
          key={dot}
          className={current ? "bg-foreground" : "bg-tertiary"}
          style={{ width: CELL / 2, height: CELL / 2 }}
        />
      ))}
    </View>
  );
}

type LineProps = {
  line: LyricLine;
  index: number;
  current: boolean;
  /** Share is picking lines: a tap selects instead of seeking. */
  picking: boolean;
  selected: boolean;
  onSeek: (line: LyricLine, index: number) => void;
  onPick: (index: number) => void;
  onLayoutLine: (index: number, y: number) => void;
};

/**
 * One synced line: ink while it's sung, graphite otherwise. Tap it to play
 * from there. While Share picks lines, ink on a faint backdrop marks the
 * selected ones, and a tap picks instead.
 */
const SyncedLine = memo(function SyncedLine({
  line,
  index,
  current,
  picking,
  selected,
  onSeek,
  onPick,
  onLayoutLine,
}: LineProps) {
  const foreground = useThemeColor("foreground");
  const secondary = useThemeColor("secondary");
  const selectedFill = useSelectedFill();
  const reduceMotion = useReducedMotion();
  const on = picking ? selected : current;
  const lit = useSharedValue(on ? 1 : 0);

  useEffect(() => {
    const to = on ? 1 : 0;
    lit.set(reduceMotion ? to : withTiming(to, { duration: HIGHLIGHT_MS }));
  }, [on, reduceMotion, lit]);

  const tint = useAnimatedStyle(() => ({
    color: interpolateColor(lit.get(), [0, 1], [secondary, foreground]),
  }));

  return (
    <View onLayout={(event) => onLayoutLine(index, event.nativeEvent.layout.y)}>
      <Press
        accessibilityRole="button"
        accessibilityLabel={line.text === "" ? "Instrumental" : line.text}
        accessibilityHint={picking ? "Selects this line to share" : "Plays from this line"}
        accessibilityState={{ selected: on }}
        onPress={() => (picking ? onPick(index) : onSeek(line, index))}
        // Picking gives its own haptic, another one for a tap that can't select.
        haptic={picking ? undefined : "selection"}
        depth={0.015}
        style={[
          LINE_INSET,
          { paddingVertical: CELL },
          picking && selected && { backgroundColor: selectedFill },
        ]}
      >
        {line.text === "" ? (
          <PauseDots current={!picking && current} />
        ) : (
          <Animated.Text className="font-sans text-title2 font-medium" style={tint}>
            {line.text}
          </Animated.Text>
        )}
      </Press>
    </View>
  );
});

/**
 * Synced lyrics: the sung line lights up and rests a third of the way down,
 * scrolling along with the song. Scrolling by hand stops the follow until a
 * few seconds after the finger lifts; tapping a line seeks there. While Share
 * picks lines they don't follow the song.
 */
function SyncedLyrics({
  lines,
  picking,
}: {
  lines: readonly LyricLine[];
  picking: Picking | null;
}) {
  const { positionMs } = usePlayhead();
  const index = currentLyricIndex(lines, positionMs);
  const reduceMotion = useReducedMotion();
  const scroll = useRef<ScrollViewInstance>(null);
  const [height, setHeight] = useState(0);
  const offsets = useRef<number[]>([]);
  const following = useRef(true);
  const resume = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The sung line, for scrolls that start outside a render (timers, layout callbacks).
  const currentIndex = useRef(index);
  const isPicking = picking !== null;
  const pickingNow = useRef(isPicking);

  const scrollToCurrent = useCallback(
    (animated: boolean) => {
      if (!following.current || height === 0) return;
      const at = currentIndex.current;
      const y = at < 0 ? 0 : offsets.current[at];
      if (y === undefined) return;
      scroll.current?.scrollTo({ y: Math.max(0, y - height * ANCHOR), animated });
    },
    [height],
  );

  // Picking stops the follow; done picking, the sung line comes back to rest.
  useEffect(() => {
    if (pickingNow.current === isPicking) return;
    pickingNow.current = isPicking;
    following.current = !isPicking;
    if (!isPicking) scrollToCurrent(!reduceMotion);
  }, [isPicking, scrollToCurrent, reduceMotion]);

  // Follow the song from line to line.
  useEffect(() => {
    currentIndex.current = index;
    scrollToCurrent(!reduceMotion);
  }, [index, scrollToCurrent, reduceMotion]);

  const stopResume = useCallback((): void => {
    if (resume.current !== null) clearTimeout(resume.current);
    resume.current = null;
  }, []);
  useEffect(() => stopResume, [stopResume]);

  const onSeek = useCallback(
    (line: LyricLine, at: number) => {
      stopResume();
      following.current = true;
      seekTo(line.timeMs);
      // Brings the tapped line to rest even when it's the one already sung.
      currentIndex.current = at;
      scrollToCurrent(!reduceMotion);
    },
    [stopResume, scrollToCurrent, reduceMotion],
  );

  const onLayoutLine = useCallback((at: number, y: number) => {
    offsets.current[at] = y;
  }, []);

  // Stable across selections, so only the lines whose selection changed render again.
  const pick = useRef(picking?.onTap);
  useEffect(() => {
    pick.current = picking?.onTap;
  });
  const onPick = useCallback((at: number) => pick.current?.(at), []);

  return (
    <ScrollView
      ref={scroll}
      className="flex-1"
      showsVerticalScrollIndicator={false}
      onLayout={(event) => setHeight(event.nativeEvent.layout.height)}
      // Lines laid out (or the view resized): put the sung line in place without a slide.
      onContentSizeChange={() => scrollToCurrent(false)}
      onScrollBeginDrag={() => {
        stopResume();
        following.current = false;
      }}
      onScrollEndDrag={() => {
        stopResume();
        resume.current = setTimeout(() => {
          if (pickingNow.current) return;
          following.current = true;
          scrollToCurrent(!reduceMotion);
        }, RESUME_FOLLOW_MS);
      }}
      contentContainerStyle={{ paddingTop: CELL * 2, paddingBottom: height * (1 - ANCHOR) }}
    >
      {lines.map((line, at) => (
        <SyncedLine
          // Lines never reorder; a time can't repeat, as Core merges lines that share one.
          key={line.timeMs}
          line={line}
          index={at}
          current={at === index}
          picking={isPicking}
          selected={picking?.isSelected(at) ?? false}
          onSeek={onSeek}
          onPick={onPick}
          onLayoutLine={onLayoutLine}
        />
      ))}
    </ScrollView>
  );
}

/**
 * Unsynced lyrics: the words as tagged, to scroll through at your own pace.
 * While Share picks lines each is a tap target, the selected ones in ink on a
 * faint backdrop and the rest in graphite.
 */
function UnsyncedLyrics({ lines, picking }: { lines: readonly string[]; picking: Picking | null }) {
  const selectedFill = useSelectedFill();
  return (
    <ScrollView
      className="flex-1"
      showsVerticalScrollIndicator={false}
      contentContainerStyle={{ paddingTop: CELL * 2, paddingBottom: CELL * 6 }}
    >
      {lines.map((line, at) => {
        if (line === "") {
          // A blank line between stanzas.
          return <View key={at} style={{ height: CELL * 2 }} />;
        }
        if (picking === null) {
          return (
            <View key={at} style={LINE_INSET}>
              <Text className="font-sans text-title2 font-medium text-foreground">{line}</Text>
            </View>
          );
        }
        const selected = picking.isSelected(at);
        return (
          <Press
            key={at}
            accessibilityRole="button"
            accessibilityLabel={line}
            accessibilityHint="Selects this line to share"
            accessibilityState={{ selected }}
            onPress={() => picking.onTap(at)}
            depth={0.015}
            style={[LINE_INSET, selected && { backgroundColor: selectedFill }]}
          >
            <Text
              className={`font-sans text-title2 font-medium ${selected ? "text-foreground" : "text-secondary"}`}
            >
              {line}
            </Text>
          </Press>
        );
      })}
    </ScrollView>
  );
}

/** The row above the lyrics while Share picks lines: Cancel, how many, and Next. */
function PickingBar({
  count,
  onCancel,
  onNext,
}: {
  count: number;
  onCancel: () => void;
  onNext: () => void;
}) {
  return (
    <View className="flex-row items-center justify-between" style={{ height: grid.row + CELL * 2 }}>
      <TextButton label="Cancel" onPress={onCancel} />
      <Text className="font-sans text-subheadline text-secondary" accessibilityLiveRegion="polite">
        {count === 0
          ? `Select up to ${MAX_SHARED_LYRIC_LINES} lines`
          : `${count} of ${MAX_SHARED_LYRIC_LINES}`}
      </Text>
      <TextButton label="Next" onPress={onNext} disabled={count === 0} />
    </View>
  );
}

/** How wide each placeholder line of the skeleton is, as a share of the view: ragged, as lyrics are. */
const SKELETON_LINES = ["72%", "58%", "84%", "46%", "66%", "78%", "52%", "70%"] as const;

/**
 * Placeholder lyric lines while a song's lyrics are searched online,
 * each as tall as a line of lyrics. It holds still, as the mixes' skeleton
 * does: a pulse would re-blur the glass on every frame.
 */
function LyricsSkeleton() {
  return (
    <DismissArea style={{ flex: 1 }}>
      <View
        accessible
        accessibilityLabel="Searching for lyrics"
        accessibilityState={{ busy: true }}
        style={{ paddingTop: CELL * 2 }}
      >
        {SKELETON_LINES.map((width, at) => (
          // A title2 line (global.css's 28 line height) with a lyric line's padding.
          <View key={at} style={{ paddingVertical: CELL }}>
            <SkeletonLine lineHeight={28} width={width} />
          </View>
        ))}
      </View>
    </DismissArea>
  );
}

/** What the Lyrics view shows: lyrics (or a Library file's none), or an online search's state. */
type Shown = LibraryLyricsShown | Exclude<NonDLyricsShown, { kind: "lyrics" }>;

/** The lyrics themselves, the search's skeleton, or the empty state. */
function LyricsBody({
  shown,
  picking,
  retry,
}: {
  shown: Shown | null;
  picking: Picking | null;
  retry: () => void;
}) {
  // Reading takes a moment; an empty field avoids flashing the empty state.
  if (shown === null) {
    return (
      <DismissArea style={{ flex: 1 }}>
        <View className="flex-1" />
      </DismissArea>
    );
  }

  switch (shown.kind) {
    case "synced":
      return <SyncedLyrics lines={shown.lines} picking={picking} />;
    case "unsynced":
      return <UnsyncedLyrics lines={shown.lines} picking={picking} />;
    case "searching":
      return <LyricsSkeleton />;
    case "none":
      return (
        <DismissArea style={{ flex: 1 }}>
          <EmptyState
            icon={IconQuoteOff}
            title="No lyrics"
            message="Add lyrics to this song's tags, or put an .lrc file with the same name beside it."
          />
        </DismissArea>
      );
    case "off":
      return (
        <DismissArea style={{ flex: 1 }}>
          <EmptyState
            icon={IconQuoteOff}
            title="No lyrics"
            message="Turn on Fix songs online in Settings › Lyrics and tags to find this song's lyrics."
          />
        </DismissArea>
      );
    case "notFound":
      return (
        <DismissArea style={{ flex: 1 }}>
          <EmptyState
            icon={IconQuoteOff}
            title="No lyrics found"
            message="Wave couldn't find lyrics for this song online."
          />
        </DismissArea>
      );
    case "failed":
      return (
        <DismissArea style={{ flex: 1 }}>
          <EmptyState
            icon={IconQuoteOff}
            title="Couldn't search for lyrics"
            message="Check your connection and try again."
            action={<TextButton label="Try Again" onPress={retry} />}
          />
        </DismissArea>
      );
  }
}

type Item = NonNullable<PlaybackState["item"]>;

/**
 * The Lyrics view under what's playing, for the Library track's [file] (a
 * Library song's, or a streamed song's downloaded since it was queued;
 * searched online when it has no lyrics, `useLibraryLyrics`), or, with no
 * file, for the non-D song [nonDTrackId] (null while it waits for the
 * Library to be read), whose lyrics are searched online
 * (`useNonDLyrics`): synced lyrics that follow the song,
 * unsynced lyrics as text, a skeleton while it searches, or an empty state
 * when the song has none. A song with lyrics gets Share, which picks up to
 * five lines (Core's `tapLyricLine`), then Next previews them as a card
 * (`LyricCardPreview`) in the cover's colours.
 */
export function LyricsView({
  file,
  nonDTrackId,
  item,
  palette,
}: {
  file: LibraryFile | null;
  nonDTrackId: string | null;
  item: Item;
  palette: ArtworkPalette | null;
}) {
  const path = file?.path ?? null;
  const library = useLibraryLyrics(file?.id ?? null, path);
  const nonD = useNonDLyrics(file === null ? nonDTrackId : null);
  const shown: Shown | null =
    nonD.shown === null
      ? library.shown
      : nonD.shown.kind === "lyrics"
        ? nonD.shown.lyrics
        : nonD.shown;
  const lyrics =
    shown !== null && (shown.kind === "synced" || shown.kind === "unsynced") ? shown : null;
  const lines = useMemo(() => shareableLyricLines(lyrics), [lyrics]);
  // The song whose lines are picked: its file, or a non-D song's track id.
  const song = path ?? nonDTrackId;
  // The lines picked for that song; another song's lyrics start afresh.
  const [picked, setPicked] = useState<{
    readonly song: string | null;
    readonly selection: LyricSelection | null;
  } | null>(null);
  const isPicking = picked !== null && picked.song === song && lines !== null;
  const selection = isPicking ? picked.selection : null;

  // Back leaves picking (the card's preview, over it, takes Back first).
  useEffect(() => {
    if (!isPicking) return undefined;
    return addScreenBackHandler(() => {
      setPicked(null);
      return true;
    });
  }, [isPicking]);

  // Leaving the lyrics (another view, Now Playing closing) closes the card too.
  useEffect(() => closeLyricCard, []);

  const onTap = useCallback(
    (index: number) => {
      if (lines === null) return;
      const tap = tapLyricLine(lines, selection, index);
      if (!tap.accepted) {
        // It would break the block or go past five lines.
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        return;
      }
      void Haptics.selectionAsync();
      setPicked({ song, selection: tap.selection });
    },
    [lines, selection, song],
  );

  const picking = useMemo<Picking | null>(
    () =>
      isPicking && lines !== null
        ? { isSelected: (at) => isLyricLineSelected(lines, selection, at), onTap }
        : null,
    [isPicking, lines, selection, onTap],
  );

  const shared = lines === null ? [] : sharedLyricLines(lines, selection);

  const next = (): void => {
    if (shared.length === 0) return;
    openLyricCard({
      title: item.title ?? "Unknown title",
      artist: item.artist ?? "Unknown Artist",
      artworkUri: item.artworkUri ?? undefined,
      lines: shared,
      colours: lyricCardColours(palette),
    });
  };

  return (
    <View className="flex-1">
      <DismissArea>
        {isPicking ? (
          <PickingBar count={shared.length} onCancel={() => setPicked(null)} onNext={next} />
        ) : (
          <View className="flex-row items-center">
            <View className="flex-1">
              <TrackHeader item={item} />
            </View>
            {lines !== null && (
              // The icon's 48dp target reaches past the margin, so the glyph lines up with it.
              <View style={{ marginRight: -12 }}>
                <IconButton
                  icon={IconShare3}
                  label="Share Lyrics"
                  onPress={() => setPicked({ song, selection: null })}
                />
              </View>
            )}
          </View>
        )}
      </DismissArea>
      <LyricsBody
        shown={shown}
        picking={picking}
        retry={nonD.shown === null ? library.retry : nonD.retry}
      />
    </View>
  );
}
