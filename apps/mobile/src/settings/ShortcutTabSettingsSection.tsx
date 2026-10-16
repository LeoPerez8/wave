import { IconCheck } from "@tabler/icons-react-native";
import { SHORTCUT_TAB_CHOICES } from "@wave/core";
import { Text, View } from "react-native";

import { CatalogLine } from "@/catalog/CatalogLine";
import { grid } from "@/catalog/grid";
import { Hairline } from "@/catalog/Hairline";
import { findSection } from "@/catalog/sections";
import { Press } from "@/motion/Press";
import { useThemeColor } from "@/theme/useThemeColor";

import { setShortcutTab, useShortcutTab } from "./shortcutTab";

/** One of the shortcut tab choices; the current one carries a check. */
function ShortcutChoice({
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

/** Settings › Appearance › Shortcut tab: the Library section kept as a third tab, or none. */
export function ShortcutTabSettingsSection() {
  const shortcut = useShortcutTab();
  return (
    <View>
      <CatalogLine className="mb-2">Shortcut tab</CatalogLine>
      <Hairline />
      <View accessibilityRole="radiogroup" accessibilityLabel="Shortcut tab">
        {SHORTCUT_TAB_CHOICES.map((choice) => (
          <ShortcutChoice
            key={choice ?? "none"}
            label={choice === null ? "None" : (findSection(choice)?.label ?? choice)}
            chosen={choice === shortcut}
            onPress={() => setShortcutTab(choice)}
          />
        ))}
      </View>
      <Text className="mt-2 font-sans text-footnote text-secondary">
        A Library section to keep one tap away, as a third tab beside Home and Library.
      </Text>
    </View>
  );
}
