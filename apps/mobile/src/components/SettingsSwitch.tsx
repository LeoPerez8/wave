import { Switch, Text, View } from "react-native";

import { grid } from "@/catalog/grid";
import { useThemeColor } from "@/theme/useThemeColor";

/** Settings' switch: a label, then the switch in the theme's colours; also its accessible name. */
export function SettingsSwitch({
  label,
  value,
  onValueChange,
  disabled = false,
}: {
  label: string;
  value: boolean;
  onValueChange: (value: boolean) => void;
  disabled?: boolean;
}) {
  const accent = useThemeColor("accent");
  const fill = useThemeColor("fill");
  const surface = useThemeColor("surface");
  return (
    <View className="flex-row items-center" style={{ minHeight: grid.row }}>
      <Text className="flex-1 font-sans text-title3 font-normal text-foreground">{label}</Text>
      <Switch
        accessibilityLabel={label}
        value={value}
        disabled={disabled}
        onValueChange={onValueChange}
        trackColor={{ false: fill, true: accent }}
        thumbColor={surface}
      />
    </View>
  );
}
