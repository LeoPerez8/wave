import { IconArrowsShuffle, IconPlayerPlay } from "@tabler/icons-react-native";
import type { ComponentType } from "react";
import { Text, View } from "react-native";

import { Press } from "@/motion/Press";
import { useThemeColor } from "@/theme/useThemeColor";

import { CELL } from "./grid";

type IconProps = { size?: number; color?: string; strokeWidth?: number };

function Action({
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

type Props = { onPlay: () => void; onShuffle: () => void };

/** Play and Shuffle for a list: two teal line-icon actions, no containers. */
export function PlayShuffle({ onPlay, onShuffle }: Props) {
  return (
    <View className="flex-row" style={{ gap: CELL * 4 }}>
      <Action icon={IconPlayerPlay} label="Play" onPress={onPlay} />
      <Action icon={IconArrowsShuffle} label="Shuffle" onPress={onShuffle} />
    </View>
  );
}
