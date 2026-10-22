import type { ReactNode } from "react";
import { Text, View, type PressableProps } from "react-native";

import { Press } from "@/motion/Press";

import { CheckCell } from "../CheckCell";
import { CELL, grid } from "../grid";

/** Space between a card's cover and its caption. */
export const CAPTION_TOP = CELL;

/** global.css's line heights for body and footnote, in dp. */
const BODY_LINE = 22;
const FOOTNOTE_LINE = 18;

/** A line's height at [fontScale]: its text grows with the font, so the line does too. */
const scaled = (line: number, fontScale: number): number => line * Math.max(1, fontScale);

/** Height of a card's title line at [fontScale]. */
export const titleLineHeight = (fontScale: number): number => scaled(BODY_LINE, fontScale);

/**
 * Height of a card's caption at [fontScale]: the space above it, then its title
 * and its detail line (both one line, so fixed-height lists can lay out by index).
 */
export const captionHeight = (fontScale: number): number =>
  CAPTION_TOP + scaled(BODY_LINE, fontScale) + scaled(FOOTNOTE_LINE, fontScale);

/** A card's title: one line, body medium, foreground. */
export function CardTitle({ children, centred = false }: { children: string; centred?: boolean }) {
  return (
    <Text
      numberOfLines={1}
      className="font-sans text-body font-medium text-foreground"
      style={centred ? { textAlign: "center" } : undefined}
    >
      {children}
    </Text>
  );
}

/** A card's second line: one line of secondary text, footnote under a tile, body in a row. */
export function CardDetail({ children, size }: { children: string; size: "footnote" | "body" }) {
  return (
    <Text
      numberOfLines={1}
      className={`font-sans text-secondary ${size === "body" ? "text-body" : "text-footnote"}`}
      style={{ fontVariant: ["tabular-nums"] }}
    >
      {children}
    </Text>
  );
}

/**
 * A card in a list: its lead (a cover, a circle) and a title over a detail
 * line, at the list's row height (`grid.row`, 56dp, so long lists lay out by
 * index). Taps and long presses run [onPress] and [onLongPress]. In selection
 * mode ([checked] given) it leads with a check cell and reads as a checkbox.
 */
export function CardRow({
  lead,
  title,
  detail,
  onPress,
  onLongPress,
  checked,
  accessibilityActions,
  onAccessibilityAction,
}: {
  lead: ReactNode;
  title: string;
  detail: string;
  onPress: () => void;
  onLongPress?: (() => void) | undefined;
  checked?: boolean | undefined;
  /** Actions for screen readers beyond a tap and a long press (Move up, Move down). */
  accessibilityActions?: PressableProps["accessibilityActions"];
  onAccessibilityAction?: PressableProps["onAccessibilityAction"];
}) {
  const selecting = checked !== undefined;
  return (
    <Press
      accessibilityRole={selecting ? "checkbox" : "button"}
      accessibilityLabel={`${title}, ${detail}`}
      accessibilityState={selecting ? { checked } : undefined}
      onPress={onPress}
      onLongPress={onLongPress}
      accessibilityActions={accessibilityActions}
      onAccessibilityAction={onAccessibilityAction}
      haptic="selection"
      depth={0.015}
    >
      <View className="flex-row items-center" style={{ height: grid.row, gap: CELL * 1.5 }}>
        {selecting && <CheckCell checked={checked} />}
        {lead}
        <View className="flex-1 justify-center">
          <CardTitle>{title}</CardTitle>
          <CardDetail size="body">{detail}</CardDetail>
        </View>
      </View>
    </Press>
  );
}

/**
 * A card on a shelf or in a grid: its content at [width], pressable as a whole.
 * In selection mode ([checked] given) it reads as a checkbox; the card draws
 * its own check over the cover.
 */
export function CardTile({
  width,
  label,
  onPress,
  onLongPress,
  checked,
  accessibilityActions,
  onAccessibilityAction,
  children,
}: {
  width: number;
  label: string;
  onPress: () => void;
  onLongPress?: (() => void) | undefined;
  checked?: boolean | undefined;
  /** Actions for screen readers beyond a tap and a long press (Move up, Move down). */
  accessibilityActions?: PressableProps["accessibilityActions"];
  onAccessibilityAction?: PressableProps["onAccessibilityAction"];
  children: ReactNode;
}) {
  const selecting = checked !== undefined;
  return (
    <Press
      accessibilityRole={selecting ? "checkbox" : "button"}
      accessibilityLabel={label}
      accessibilityState={selecting ? { checked } : undefined}
      onPress={onPress}
      onLongPress={onLongPress}
      accessibilityActions={accessibilityActions}
      onAccessibilityAction={onAccessibilityAction}
      depth={0.02}
      style={{ width }}
    >
      {children}
    </Press>
  );
}
