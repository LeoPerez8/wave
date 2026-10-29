import { formatNumber } from "@wave/core";
import { useLocalisation } from "@/localisation/localisation";
import { IconCheck } from "@tabler/icons-react-native";
import { useEffect, useState } from "react";
import { Text, View } from "react-native";
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";

import { ENTRY } from "@/motion/entry";
import { Press } from "@/motion/Press";
import { useThemeColor } from "@/theme/useThemeColor";

import { CELL, grid } from "./grid";
import { Hairline } from "./Hairline";

type Props = {
  label: string;
  /** Item count, when known; the column stays reserved either way. */
  count?: number | undefined;
  onPress: () => void;
  /** Opens the entry's menu, where it has one. */
  onLongPress?: (() => void) | undefined;
  /** The hairline under the entry; the last entry in a card goes without. */
  divider?: boolean;
  /** Looks pressed: the entry a finger sliding across its menu would run. */
  highlighted?: boolean;
  /** The current choice among the card's entries (a sort): marked with a check. */
  selected?: boolean;
  /** Deletes something (a song's file): the label in the destructive colour. */
  destructive?: boolean;
  /**
   * A short line saying what the entry does, in secondary text under its
   * label while `lineShown`. Screen readers always read it, as the hint.
   */
  line?: string | undefined;
  /** Shows `line`: it fades in as the row opens room for it, and out as it closes. */
  lineShown?: boolean;
};

/** A Library entry (Playlists, Artists, …): one quiet line of type, no icon, no chevron. */
export function EntryRow({
  label,
  count,
  onPress,
  onLongPress,
  divider = true,
  highlighted = false,
  selected = false,
  destructive = false,
  line,
  lineShown = false,
}: Props) {
  const accent = useThemeColor("accent");
  const { language } = useLocalisation();
  return (
    <Press
      accessibilityRole="button"
      accessibilityLabel={
        count === undefined ? label : `${label}, ${formatNumber(language, count)}`
      }
      accessibilityHint={line}
      onPress={onPress}
      onLongPress={onLongPress}
      accessibilityState={{ selected }}
      haptic="selection"
      highlighted={highlighted}
    >
      {/* At least a row tall, taller where large text or a wrapping label needs it. */}
      <View className="flex-row items-center" style={{ minHeight: grid.row }}>
        <View className="flex-1" style={{ paddingVertical: CELL / 2 }}>
          <Text
            className={`font-sans text-title3 font-normal ${destructive ? "text-destructive" : "text-foreground"}`}
          >
            {label}
          </Text>
          {line !== undefined && <EntryLine text={line} shown={lineShown} />}
        </View>
        {selected ? (
          <IconCheck size={22} color={accent} strokeWidth={1.75} />
        ) : (
          <Text
            className="font-sans text-subheadline text-secondary"
            style={{ fontVariant: ["tabular-nums"] }}
          >
            {count === undefined ? "" : formatNumber(language, count)}
          </Text>
        )}
      </View>
      {divider && <Hairline />}
    </Press>
  );
}

/**
 * An entry's line under its label. Shown from the start, it is simply laid
 * out, so the card measures its full height as it opens. Shown or hidden
 * later, the row's room for it eases open to the line's measured height (or
 * closed) while the line fades, so the card grows and shrinks without a jump;
 * with reduce motion the room opens at once and the line only fades.
 */
function EntryLine({ text, shown }: { text: string; shown: boolean }) {
  const reduceMotion = useReducedMotion();
  const [shownAtFirst] = useState(shown);
  // The line's own height, measured even while the row gives it no room.
  const height = useSharedValue(0);
  const room = useSharedValue(shown ? 1 : 0);
  const opacity = useSharedValue(shown ? 1 : 0);

  useEffect(() => {
    const to = shown ? 1 : 0;
    room.set(reduceMotion ? to : withTiming(to, { duration: ENTRY.riseMs, easing: ENTRY.ease }));
    opacity.set(
      withTiming(to, {
        duration: reduceMotion ? ENTRY.fadeMs : ENTRY.riseMs,
        easing: ENTRY.ease,
      }),
    );
  }, [shown, reduceMotion, room, opacity]);

  const style = useAnimatedStyle(() => {
    const measured = height.get();
    // Not measured yet: a line shown from the start takes its natural room, a hidden one none.
    if (measured === 0)
      return shownAtFirst ? { opacity: opacity.get() } : { height: 0, opacity: 0 };
    return { height: measured * room.get(), opacity: opacity.get() };
  });

  return (
    // The row's hint already reads it to screen readers.
    <Animated.View
      className="overflow-hidden"
      style={style}
      importantForAccessibility="no-hide-descendants"
    >
      {/* Never shrunk by the room around it, so it reports its full height. */}
      <Text
        className="font-sans text-subheadline text-secondary"
        style={{ flexShrink: 0, paddingTop: CELL / 4 }}
        onLayout={(event) => height.set(event.nativeEvent.layout.height)}
      >
        {text}
      </Text>
    </Animated.View>
  );
}
