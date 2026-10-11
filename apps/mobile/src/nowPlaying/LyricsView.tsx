import { IconQuoteOff } from "@tabler/icons-react-native";
import { currentLyricIndex, type LyricLine } from "@wave/core";
import { memo, useCallback, useEffect, useRef, useState } from "react";
import { ScrollView, Text, View, type ScrollViewInstance } from "react-native";
import Animated, {
  interpolateColor,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";

import { CELL } from "@/catalog/grid";
import { EmptyState } from "@/components/EmptyState";
import { Press } from "@/motion/Press";
import { seekTo } from "@/playback/actions";
import { useThemeColor } from "@/theme/useThemeColor";

import { DismissArea } from "./DismissArea";
import { usePlayhead } from "./hooks";
import { useLyrics } from "./useLyrics";

/** Where the sung line rests, as a fraction of the view's height from its top. */
const ANCHOR = 0.3;
/** How long after the finger leaves the lyrics they start following the song again. */
const RESUME_FOLLOW_MS = 3000;
/** The sung line's tint eases in over this long. */
const HIGHLIGHT_MS = 240;

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
  onSeek: (line: LyricLine, index: number) => void;
  onLayoutLine: (index: number, y: number) => void;
};

/** One synced line: ink while it's sung, graphite otherwise. Tap it to play from there. */
const SyncedLine = memo(function SyncedLine({
  line,
  index,
  current,
  onSeek,
  onLayoutLine,
}: LineProps) {
  const foreground = useThemeColor("foreground");
  const secondary = useThemeColor("secondary");
  const reduceMotion = useReducedMotion();
  const lit = useSharedValue(current ? 1 : 0);

  useEffect(() => {
    const to = current ? 1 : 0;
    lit.set(reduceMotion ? to : withTiming(to, { duration: HIGHLIGHT_MS }));
  }, [current, reduceMotion, lit]);

  const tint = useAnimatedStyle(() => ({
    color: interpolateColor(lit.get(), [0, 1], [secondary, foreground]),
  }));

  return (
    <View onLayout={(event) => onLayoutLine(index, event.nativeEvent.layout.y)}>
      <Press
        accessibilityRole="button"
        accessibilityLabel={line.text === "" ? "Instrumental" : line.text}
        accessibilityHint="Plays from this line"
        accessibilityState={{ selected: current }}
        onPress={() => onSeek(line, index)}
        haptic="selection"
        depth={0.015}
        style={{ paddingVertical: CELL }}
      >
        {line.text === "" ? (
          <PauseDots current={current} />
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
 * few seconds after the finger lifts; tapping a line seeks there.
 */
function SyncedLyrics({ lines }: { lines: readonly LyricLine[] }) {
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
          onSeek={onSeek}
          onLayoutLine={onLayoutLine}
        />
      ))}
    </ScrollView>
  );
}

/** Unsynced lyrics: the words as tagged, to scroll through at your own pace. */
function UnsyncedLyrics({ lines }: { lines: readonly string[] }) {
  return (
    <ScrollView
      className="flex-1"
      showsVerticalScrollIndicator={false}
      contentContainerStyle={{ paddingTop: CELL * 2, paddingBottom: CELL * 6 }}
    >
      {lines.map((line, at) =>
        line === "" ? (
          // A blank line between stanzas.
          <View key={at} style={{ height: CELL * 2 }} />
        ) : (
          <Text key={at} className="font-sans text-title2 font-medium text-foreground">
            {line}
          </Text>
        ),
      )}
    </ScrollView>
  );
}

/**
 * The Lyrics view's body for the file at `path`: synced lyrics that follow
 * the song, unsynced lyrics as text, or an empty state when the song has none.
 */
export function LyricsView({ path }: { path: string | null }) {
  const lyrics = useLyrics(path);

  // Reading takes a moment; an empty field avoids flashing the empty state.
  if (lyrics === null) {
    return (
      <DismissArea style={{ flex: 1 }}>
        <View className="flex-1" />
      </DismissArea>
    );
  }

  switch (lyrics.kind) {
    case "synced":
      return <SyncedLyrics lines={lyrics.lines} />;
    case "unsynced":
      return <UnsyncedLyrics lines={lyrics.lines} />;
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
  }
}
