import {
  MARQUEE,
  marqueeOffset,
  marqueePlan,
  marqueeStill,
  readsRightToLeft,
  type MarqueeLineSize,
  type MarqueePlan,
} from "@wave/core";
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { Text, View, type AccessibilityRole } from "react-native";
import Animated, {
  cancelAnimation,
  Easing,
  ReduceMotion,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";

import { NativeFadeEdges, WaveGlass } from "@/glass/waveGlass";
import { playheadVisibility } from "./playhead";

/**
 * Wide enough for any line's text on one line: the text is measured and moved
 * inside a strip this wide, clipped to the line.
 */
const STRIP_WIDTH = 4096;

/**
 * Now Playing's lines that scroll together (Core's `marqueePlan`): each line
 * reports its size, and they share one plan and one clock.
 */
export type MarqueeGroup = {
  /** The lines hold still, ending in an ellipsis (reduce motion, or animations removed). */
  readonly still: boolean;
  readonly plan: MarqueePlan | null;
  /**
   * Milliseconds since the lines last started over at their rest, on the UI
   * thread; every line's offset is read from it (Core's `marqueeOffset`), so
   * they never drift apart.
   */
  readonly clock: SharedValue<number>;
  readonly report: (index: number, size: MarqueeLineSize) => void;
};

/**
 * The scrolling group for [texts], one per line in order (null for a line not
 * shown, as the album under a notice). The lines start over at their rest when
 * Now Playing opens or Wave comes back to it, when a line's text changes, and
 * when the plan's timings change; the player view coming back from Queue or
 * Lyrics remounts this effect, which starts them over too. Android's animator
 * duration scale is read at each render (a cheap synchronous call), so a
 * change in Developer options applies the next time they start over.
 */
export const useMarqueeGroup = (texts: readonly (string | null)[]): MarqueeGroup => {
  const live = useSyncExternalStore(playheadVisibility.subscribe, playheadVisibility.get);
  const reduceMotion = useReducedMotion();
  const [sizes, setSizes] = useState<readonly (MarqueeLineSize | null)[]>([]);
  const scale = WaveGlass.animatorDurationScale();
  const still = marqueeStill({ reduceMotion, animatorScale: scale });
  const shown = texts.map((text) => (text === null ? "0" : "1")).join("");
  const plan = useMemo(
    () =>
      still
        ? null
        : marqueePlan(
            Array.from(shown, (line, index) => (line === "1" ? (sizes[index] ?? null) : null)),
            scale,
          ),
    [still, sizes, scale, shown],
  );
  const clock = useSharedValue(0);
  // What starts the lines over: a plan that only got a new identity (a line
  // measured again at the same size) doesn't.
  const timings =
    plan === null
      ? null
      : [plan.cycleMs, ...plan.lines.map((line) => line?.scrollMs ?? 0)].join(" ");
  const start = live ? texts.join("\u0000") : null;
  const cycleMs = plan?.cycleMs ?? 0;
  useEffect(() => {
    cancelAnimation(clock);
    clock.set(0);
    if (start === null || timings === null || cycleMs <= 0) return;
    clock.set(
      withRepeat(
        withTiming(cycleMs, {
          duration: cycleMs,
          easing: Easing.linear,
          // The plan already holds still under reduce motion.
          reduceMotion: ReduceMotion.Never,
        }),
        -1,
        false,
        undefined,
        ReduceMotion.Never,
      ),
    );
    return () => cancelAnimation(clock);
  }, [clock, start, timings, cycleMs]);
  const report = useCallback((index: number, size: MarqueeLineSize) => {
    setSizes((current) => {
      const was = current[index] ?? null;
      if (was?.text === size.text && was.box === size.box) return current;
      // Dense, so a line not yet measured reads as null rather than a hole.
      return Array.from({ length: Math.max(current.length, index + 1) }, (_, at) =>
        at === index ? size : (current[at] ?? null),
      );
    });
  }, []);
  return { still, plan, clock, report };
};

type MarqueeTextProps = {
  text: string;
  group: MarqueeGroup;
  /** This line's place in the group's texts. */
  index: number;
  className: string;
  /**
   * Whether the line is its own screen-reader element (read as [text], with
   * [role]); false inside a control that labels it, as a link.
   */
  standalone: boolean;
  role?: AccessibilityRole;
  /**
   * The line spans its parent's width, as the title does, rather than hugging
   * its text inside a control: right-to-left text then sits on its right.
   */
  fill?: boolean;
};

/**
 * One of Now Playing's lines: when its text is too long for it, it rests at
 * its start, then scrolls in a loop back round to it, with its group, and
 * fades out at the edges (docs/spec.md, "Now Playing's long names"). A line
 * that fits looks as a plain one-line text; under reduce motion or with
 * animations removed it holds still and ends in an ellipsis.
 */
export function MarqueeText(props: MarqueeTextProps) {
  const { text, group, className, standalone, role } = props;
  if (group.still) {
    return (
      <Text
        numberOfLines={1}
        className={className}
        accessibilityRole={standalone ? role : undefined}
      >
        {text}
      </Text>
    );
  }
  return <ScrollingLine {...props} />;
}

function ScrollingLine({
  text,
  group,
  index,
  className,
  standalone,
  role,
  fill = false,
}: MarqueeTextProps) {
  const rtl = readsRightToLeft(text);
  const [textWidth, setTextWidth] = useState<number | null>(null);
  const [box, setBox] = useState<number | null>(null);
  const { report, plan, clock } = group;
  const line = plan?.lines[index] ?? null;

  // Only measured sizes: a line mounted again (a link becoming tappable) keeps
  // its last size until it measures the same, so the others don't start over.
  useEffect(() => {
    if (textWidth !== null && box !== null) report(index, { text: textWidth, box });
  }, [report, index, textWidth, box]);

  const moveStyle = useAnimatedStyle(() => {
    const offset = marqueeOffset(plan, line, clock.get());
    // Right to left, the line rests on its right end and moves right.
    return { transform: [{ translateX: rtl ? offset : -offset }] };
  });
  const overflows = line !== null;
  // A line that hugs its text keeps it on its left until it measures as too
  // long, so it doesn't jump sides once measured.
  const direction = rtl && (fill || overflows) ? "row-reverse" : "row";
  return (
    <NativeFadeEdges
      fixedEdge={overflows ? (rtl ? "left" : "right") : "none"}
      travel={line?.travel ?? 0}
      fadeLength={MARQUEE.fadeLength}
      onLayout={(event) => setBox(event.nativeEvent.layout.width)}
      accessible={standalone}
      accessibilityRole={standalone ? role : undefined}
      accessibilityLabel={standalone ? text : undefined}
      style={{
        // Hugs the text, as a plain one-line text does, up to the line's width.
        width: textWidth ?? undefined,
        maxWidth: "100%",
        overflow: "hidden",
        flexDirection: direction,
        alignSelf: rtl && fill ? "flex-end" : "flex-start",
      }}
    >
      <Animated.View
        collapsable={false}
        importantForAccessibility="no-hide-descendants"
        accessibilityElementsHidden
        style={[{ width: STRIP_WIDTH, flexDirection: direction }, moveStyle]}
      >
        <Text
          numberOfLines={1}
          className={className}
          onLayout={(event) => setTextWidth(event.nativeEvent.layout.width)}
        >
          {text}
        </Text>
        {overflows ? (
          <View style={rtl ? { marginRight: MARQUEE.gap } : { marginLeft: MARQUEE.gap }}>
            <Text numberOfLines={1} className={className}>
              {text}
            </Text>
          </View>
        ) : null}
      </Animated.View>
    </NativeFadeEdges>
  );
}
