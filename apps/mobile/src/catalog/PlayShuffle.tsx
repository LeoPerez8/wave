import { IconArrowsShuffle, IconPlayerPlay } from "@tabler/icons-react-native";
import type { ComponentType, ReactNode } from "react";
import { Text, View } from "react-native";

import { Press } from "@/motion/Press";
import { useThemeColor } from "@/theme/useThemeColor";

import { CELL } from "./grid";

type IconProps = { size?: number; color?: string; strokeWidth?: number };

/** One of a list's actions under its head: a teal line icon and its label, no container. */
export function ListAction({
  icon: Icon,
  label,
  onPress,
}: {
  icon: ComponentType<IconProps>;
  label: string;
  onPress: () => void;
}) {
  const accent = useThemeColor("accent");
  return (
    <Press
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      haptic="impact"
      className="flex-row items-center"
      style={{ minHeight: 48, gap: CELL }}
    >
      <Icon size={24} color={accent} strokeWidth={1.5} />
      <Text className="font-sans text-body font-medium text-accent">{label}</Text>
    </Press>
  );
}

type Props = {
  onPlay: () => void;
  onShuffle: () => void;
  /** More actions after Shuffle (a YT Music album's or a playlist's Download). */
  children?: ReactNode;
};

/**
 * Play and Shuffle for a list: two teal line-icon actions, no containers.
 * Too narrow for every action (Retry Failed beside a playlist's menu
 * button), the last ones wrap onto a second line.
 */
export function PlayShuffle({ onPlay, onShuffle, children }: Props) {
  return (
    <View className="flex-row flex-wrap" style={{ columnGap: CELL * 4, flexShrink: 1 }}>
      <ListAction icon={IconPlayerPlay} label="Play" onPress={onPlay} />
      <ListAction icon={IconArrowsShuffle} label="Shuffle" onPress={onShuffle} />
      {children}
    </View>
  );
}
