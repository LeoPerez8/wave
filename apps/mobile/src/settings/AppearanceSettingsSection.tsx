import { APPEARANCES } from "@wave/core";
import { Text, View } from "react-native";

import { CatalogLine } from "@/catalog/CatalogLine";
import { Hairline } from "@/catalog/Hairline";

import { setAppearance, useAppearance } from "./appearance";
import { ChoiceRow } from "./ChoiceRow";

/** Settings › Appearance › Appearance: follow Android's light or dark setting, or keep to one. */
export function AppearanceSettingsSection() {
  const appearance = useAppearance();
  return (
    <View>
      <CatalogLine className="mb-2">Appearance</CatalogLine>
      <Hairline />
      <View accessibilityRole="radiogroup" accessibilityLabel="Appearance">
        {APPEARANCES.map(({ id, label }) => (
          <ChoiceRow
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
