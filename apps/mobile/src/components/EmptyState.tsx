import type { ComponentType } from "react";
import { Text, View } from "react-native";

import { useThemeColor } from "@/theme/useThemeColor";

type IconProps = { size?: number; color?: string; strokeWidth?: number };

type Props = {
  icon: ComponentType<IconProps>;
  title: string;
  message: string;
};

export function EmptyState({ icon: Icon, title, message }: Props) {
  const tertiary = useThemeColor("tertiary");
  return (
    <View className="items-center gap-2 pt-24" style={{ paddingHorizontal: 16 }}>
      <Icon size={40} color={tertiary} strokeWidth={1.25} />
      <Text className="mt-3 text-center font-sans text-title3 font-normal text-foreground">
        {title}
      </Text>
      <Text className="text-center font-sans text-subheadline text-secondary">{message}</Text>
    </View>
  );
}
