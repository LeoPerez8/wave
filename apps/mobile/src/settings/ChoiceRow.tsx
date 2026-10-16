import { IconCheck } from "@tabler/icons-react-native";
import { Text, View } from "react-native";

import { grid } from "@/catalog/grid";
import { Hairline } from "@/catalog/Hairline";
import { Press } from "@/motion/Press";
import { useThemeColor } from "@/theme/useThemeColor";

/** One choice of a Settings radio list; the current one carries a check. */
export function ChoiceRow({
  label,
  chosen,
  onPress,
}: {
  label: string;
  chosen: boolean;
  onPress: () => void;
}) {
  const accent = useThemeColor("accent");
  return (
    <Press
      accessibilityRole="radio"
      accessibilityLabel={label}
      accessibilityState={{ checked: chosen }}
      onPress={onPress}
      haptic="selection"
    >
      <View className="flex-row items-center" style={{ height: grid.row }}>
        <Text className="flex-1 font-sans text-title3 font-normal text-foreground">{label}</Text>
        {chosen && <IconCheck size={24} color={accent} strokeWidth={1.5} />}
      </View>
      <Hairline />
    </Press>
  );
}
