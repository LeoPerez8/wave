import { Canvas, Circle, SweepGradient, vec } from "@shopify/react-native-skia";
import { IconCheck } from "@tabler/icons-react-native";
import {
  isDefaultThemeChoice,
  themeSwatchRows,
  type CustomSwatchOption,
  type InkGroup,
  type ThemeGroup,
  type ThemeSwatchOption,
} from "@wave/core";
import { Text, useColorScheme, View } from "react-native";

import { CatalogLine } from "@/catalog/CatalogLine";
import { Hairline } from "@/catalog/Hairline";
import { TextButton } from "@/components/TextButton";
import { IconButton } from "@/components/IconButton";
import { confirmAction } from "@/overlay/alert";

import { HUE_STOPS, openColourPicker } from "./ColourPicker";
import { resetTheme, setThemeSwatch, useThemeChoice } from "./theme";

const ROW_LABEL: Record<ThemeGroup, string> = {
  light: "Light background",
  dark: "Dark background",
  primary: "Primary",
  secondary: "Secondary",
};

const SWATCH = 36;
const TARGET = 48;

function Swatch({ swatch, group }: { swatch: ThemeSwatchOption; group: ThemeGroup }) {
  return (
    <IconButton
      accessibilityRole="radio"
      accessibilityLabel={swatch.label}
      accessibilityState={{ checked: swatch.selected }}
      onPress={() => void setThemeSwatch(group, swatch.id, confirmAction)}
      depth={0.04}
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
    </IconButton>
  );
}

/** The rainbow rim round a picked custom colour. */
const RIM = 4;

/**
 * The swatch that ends Primary and Secondary: a hue wheel until a colour is
 * picked, then that colour (as it applies) inside a rainbow rim. It opens
 * the colour picker on the picked colour, or else on the row's current one.
 */
function CustomSwatch({
  custom,
  group,
  current,
}: {
  custom: CustomSwatchOption;
  group: InkGroup;
  current: string;
}) {
  const r = SWATCH / 2;
  return (
    <IconButton
      accessibilityRole="radio"
      accessibilityLabel="Custom colour"
      accessibilityHint="Opens the colour picker"
      accessibilityState={{ checked: custom.selected }}
      onPress={() => openColourPicker(group, custom.picked ?? current)}
      depth={0.04}
      className="items-center justify-center"
      style={{ width: TARGET, height: TARGET }}
    >
      <View className="items-center justify-center" style={{ width: SWATCH, height: SWATCH }}>
        <Canvas style={{ position: "absolute", width: SWATCH, height: SWATCH }}>
          {custom.colour === null ? (
            <Circle cx={r} cy={r} r={r}>
              <SweepGradient c={vec(r, r)} colors={HUE_STOPS} />
            </Circle>
          ) : (
            <>
              <Circle cx={r} cy={r} r={r - RIM / 2} style="stroke" strokeWidth={RIM}>
                <SweepGradient c={vec(r, r)} colors={HUE_STOPS} />
              </Circle>
              <Circle cx={r} cy={r} r={r - RIM - 1} color={custom.colour} />
            </>
          )}
        </Canvas>
        {custom.selected && custom.mark !== null ? (
          <IconCheck size={18} strokeWidth={2.5} color={custom.mark} />
        ) : null}
      </View>
    </IconButton>
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
        const { custom, group } = row;
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
                <Text className="font-sans text-subheadline text-secondary">
                  {custom?.selected ? "Custom" : chosen?.label}
                </Text>
              </View>
              <View className="-mx-1.5 flex-row flex-wrap py-1">
                {row.swatches.map((swatch) => (
                  <Swatch key={swatch.id} swatch={swatch} group={row.group} />
                ))}
                {custom !== null && (group === "primary" || group === "secondary") ? (
                  <CustomSwatch
                    custom={custom}
                    group={group}
                    current={custom.colour ?? chosen?.colour ?? "#000000"}
                  />
                ) : null}
              </View>
            </View>
            <Hairline />
          </View>
        );
      })}
      <Text className="mt-2 font-sans text-footnote text-secondary">
        Cards, groups, separators and text follow the background you choose for each mode. Primary
        colours progress, toggles and what&apos;s active; secondary marks favorites and what&apos;s
        playing; the last swatch of each takes any colour. A colour that wouldn&apos;t read on your
        background is deepened or brightened until it does. The app icon takes your primary and
        secondary, or the presets closest to custom ones, once you leave Wave.
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
