import { useLocalisation } from "@/localisation/localisation";
import { APPEARANCES } from "@wave/core";
import { Text, View } from "react-native";

import { CatalogLine } from "@/catalog/CatalogLine";
import { Hairline } from "@/catalog/Hairline";
import { SettingsSwitch } from "@/components/SettingsSwitch";

import { setAppearance, useAppearance } from "./appearance";
import { ChoiceRow } from "./ChoiceRow";
import { setPageGradient, usePageGradient } from "./pageGradient";

/**
 * Settings › Appearance › Appearance: follow Android's light or dark setting, or keep to one,
 * and whether pages take a tint at their top.
 */
export function AppearanceSettingsSection() {
  const { strings } = useLocalisation();
  const appearance = useAppearance();
  const pageGradient = usePageGradient();
  return (
    <View>
      <CatalogLine className="mb-2">{strings.settings.appearance}</CatalogLine>
      <Hairline />
      <View accessibilityRole="radiogroup" accessibilityLabel={strings.settings.appearance}>
        {APPEARANCES.map(({ id }) => (
          <ChoiceRow
            key={id}
            label={strings.settings.appearances[id]}
            chosen={id === appearance}
            onPress={() => setAppearance(id)}
          />
        ))}
      </View>
      <Text className="mt-2 font-sans text-footnote text-secondary">
        {strings.settings.systemFollowsAndroidsLightOrDarkSetting}
      </Text>
      <View className="mt-6">
        <Hairline />
        <SettingsSwitch
          label={strings.settings.colourAtTheTopOfPages}
          value={pageGradient}
          onValueChange={setPageGradient}
        />
        <Hairline />
        <Text className="mt-2 font-sans text-footnote text-secondary">
          {strings.settings.aSubtleTintFadesInAtTheTop}
        </Text>
      </View>
    </View>
  );
}
