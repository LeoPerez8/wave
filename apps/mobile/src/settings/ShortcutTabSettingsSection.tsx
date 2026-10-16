import { SHORTCUT_TAB_CHOICES } from "@wave/core";
import { Text, View } from "react-native";

import { CatalogLine } from "@/catalog/CatalogLine";
import { Hairline } from "@/catalog/Hairline";
import { findSection } from "@/catalog/sections";

import { ChoiceRow } from "./ChoiceRow";
import { setShortcutTab, useShortcutTab } from "./shortcutTab";

/** Settings › Appearance › Shortcut tab: the Library section kept as a third tab, or none. */
export function ShortcutTabSettingsSection() {
  const shortcut = useShortcutTab();
  return (
    <View>
      <CatalogLine className="mb-2">Shortcut tab</CatalogLine>
      <Hairline />
      <View accessibilityRole="radiogroup" accessibilityLabel="Shortcut tab">
        {SHORTCUT_TAB_CHOICES.map((choice) => (
          <ChoiceRow
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
