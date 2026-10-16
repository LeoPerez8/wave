import { IconCheck } from "@tabler/icons-react-native";
import {
  isDefaultThemeChoice,
  themeSwatchRows,
  type ThemeChoice,
  type ThemeSwatchOption,
} from "@wave/core";
import { Text, useColorScheme, View } from "react-native";

import { CatalogLine } from "@/catalog/CatalogLine";
import { Hairline } from "@/catalog/Hairline";
import { TextButton } from "@/components/TextButton";
import { Press } from "@/motion/Press";
import { confirmAction } from "@/overlay/alert";

import { resetTheme, setThemeSwatch, useThemeChoice } from "./theme";

const ROW_LABEL: Record<keyof ThemeChoice, string> = {
  light: "Light background",
  dark: "Dark background",
  primary: "Primary",
  secondary: "Secondary",
};

const SWATCH = 36;
const TARGET = 48;

function Swatch({ swatch, group }: { swatch: ThemeSwatchOption; group: keyof ThemeChoice }) {
  return (
    <Press
      accessibilityRole="radio"
      accessibilityLabel={swatch.label}
      accessibilityState={{ checked: swatch.selected }}
      onPress={() => void setThemeSwatch(group, swatch.id, confirmAction)}
      haptic="selection"
      className="items-center justify-center"
      style={{ width: TARGET, height: TARGET }}
    >
      <View
        className={`items-center justify-center rounded-full ${
          swatch.selected ? "border-2 border-foreground" : "border border-separator"
        }`}
        style={{ width: SWATCH, height: SWATCH, backgroundColor: swatch.colour }}
      >
        {swatch.selected ? <IconCheck size={18} strokeWidth={2.5} color={swatch.mark} /> : null}
      </View>
    </Press>
  );
}

/** Settings › Appearance › Theme: background (per scheme), primary and secondary colours from swatches. */
export function ThemeSettingsSection() {
  const choice = useThemeChoice();
  const scheme = useColorScheme() === "dark" ? "dark" : "light";
  const rows = themeSwatchRows(choice, scheme);

  return (
    <View>
      <CatalogLine className="mb-2">Theme</CatalogLine>
      <Hairline />
      {rows.map((row) => {
        const chosen = row.swatches.find((swatch) => swatch.selected);
        return (
          <View key={row.group}>
            <View
              className="pt-3"
              accessibilityRole="radiogroup"
              accessibilityLabel={ROW_LABEL[row.group]}
            >
              <View className="flex-row items-baseline">
                <Text className="flex-1 font-sans text-title3 font-normal text-foreground">
                  {ROW_LABEL[row.group]}
                </Text>
                <Text className="font-sans text-subheadline text-secondary">{chosen?.label}</Text>
              </View>
              <View className="-mx-1.5 flex-row flex-wrap py-1">
                {row.swatches.map((swatch) => (
                  <Swatch key={swatch.id} swatch={swatch} group={row.group} />
                ))}
              </View>
            </View>
            <Hairline />
          </View>
        );
      })}
      <Text className="mt-2 font-sans text-footnote text-secondary">
        Cards, groups, separators and text follow the background you choose for each mode. Primary
        colours progress, toggles and what&apos;s active; secondary marks favorites and what&apos;s
        playing. A colour that wouldn&apos;t read on your background is deepened or brightened until
        it does. The app icon takes your primary and secondary once you leave Wave.
      </Text>
      <View className="mt-4 items-start">
        <TextButton
          label="Reset to defaults"
          disabled={isDefaultThemeChoice(choice)}
          onPress={() => void resetTheme(confirmAction)}
        />
      </View>
    </View>
  );
}
