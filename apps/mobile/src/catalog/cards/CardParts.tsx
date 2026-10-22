import type { ReactNode } from "react";
import { Text, View } from "react-native";

import { Press } from "@/motion/Press";

import { CELL, grid } from "../grid";

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
 * index). Taps and long presses run [onPress] and [onLongPress].
 */
export function CardRow({
  lead,
  title,
  detail,
  onPress,
  onLongPress,
}: {
  lead: ReactNode;
  title: string;
  detail: string;
  onPress: () => void;
  onLongPress?: (() => void) | undefined;
}) {
  return (
    <Press
      accessibilityRole="button"
      accessibilityLabel={`${title}, ${detail}`}
      onPress={onPress}
      onLongPress={onLongPress}
      haptic="selection"
      depth={0.015}
    >
      <View className="flex-row items-center" style={{ height: grid.row, gap: CELL * 1.5 }}>
        {lead}
        <View className="flex-1 justify-center">
          <CardTitle>{title}</CardTitle>
          <CardDetail size="body">{detail}</CardDetail>
        </View>
      </View>
    </Press>
  );
}

/** A card on a shelf or in a grid: its content at [width], pressable as a whole. */
export function CardTile({
  width,
  label,
  onPress,
  onLongPress,
  children,
}: {
  width: number;
  label: string;
  onPress: () => void;
  onLongPress?: (() => void) | undefined;
  children: ReactNode;
}) {
  return (
    <Press
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      onLongPress={onLongPress}
      depth={0.02}
      style={{ width }}
    >
      {children}
    </Press>
  );
}
