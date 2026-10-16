import { IconCheck } from "@tabler/icons-react-native";
import { APPEARANCES } from "@wave/core";
import { Text, View } from "react-native";

import { CatalogLine } from "@/catalog/CatalogLine";
import { grid } from "@/catalog/grid";
import { Hairline } from "@/catalog/Hairline";
import { Press } from "@/motion/Press";
import { useThemeColor } from "@/theme/useThemeColor";

import { setAppearance, useAppearance } from "./appearance";

/** One appearance; the current one carries a check. */
function AppearanceChoice({
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

/** Settings › Appearance › Appearance: follow Android's light or dark setting, or keep to one. */
export function AppearanceSettingsSection() {
  const appearance = useAppearance();
  return (
    <View>
      <CatalogLine className="mb-2">Appearance</CatalogLine>
      <Hairline />
      <View accessibilityRole="radiogroup" accessibilityLabel="Appearance">
        {APPEARANCES.map(({ id, label }) => (
          <AppearanceChoice
            key={id}
            label={label}
            chosen={id === appearance}
            onPress={() => setAppearance(id)}
          />
        ))}
      </View>
      <Text className="mt-2 font-sans text-footnote text-secondary">
        System follows Android&apos;s light or dark setting. Light and Dark keep Wave in that mode
        whatever Android says.
      </Text>
    </View>
  );
}
