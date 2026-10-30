import { useLocalisation } from "@/localisation/localisation";
import { Canvas, Circle, SweepGradient, vec } from "@shopify/react-native-skia";
import { IconCheck } from "@tabler/icons-react-native";
import {
  isDefaultThemeState,
  themeSwatchRows,
  type CustomSwatchOption,
  type InkGroup,
  type SavedSwatchOption,
  type ThemeGroup,
  type ThemeSwatchOption,
  type Catalogue,
} from "@wave/core";
import { Text, useColorScheme, View } from "react-native";

import { CatalogLine } from "@/catalog/CatalogLine";
import { CELL } from "@/catalog/grid";
import { Hairline } from "@/catalog/Hairline";
import { TextButton } from "@/components/TextButton";
import { IconButton } from "@/components/IconButton";
import { pressedRect } from "@/motion/pressedRect";
import { showAlert } from "@/overlay/alert";
import { CardHeading } from "@/overlay/CardHeading";
import { MenuChoices } from "@/overlay/MenuChoices";
import { openOverlay } from "@/overlay/overlay";

import { HUE_STOPS, openColourPicker } from "./ColourPicker";
import { removeSavedInk, resetTheme, setSavedInk, setThemeSwatch, useThemeState } from "./theme";

const ROW_LABEL: Record<ThemeGroup, (strings: Catalogue) => string> = {
  light: (strings) => strings.settings.lightBackground,
  dark: (strings) => strings.settings.darkBackground,
  primary: (strings) => strings.settings.primary,
  secondary: (strings) => strings.settings.secondary,
};

const SWATCH = 36;
const TARGET = 48;

/** A swatch's colour dot, ringed and checked when it's the one in use. */
function SwatchDot({ swatch }: { swatch: { colour: string; mark: string; selected: boolean } }) {
  return (
    <View
      className={`items-center justify-center rounded-full ${
        swatch.selected ? "border-2 border-foreground" : "border border-separator"
      }`}
      style={{ width: SWATCH, height: SWATCH, backgroundColor: swatch.colour }}
    >
      {swatch.selected ? <IconCheck size={18} strokeWidth={2.5} color={swatch.mark} /> : null}
    </View>
  );
}

function Swatch({ swatch, group }: { swatch: ThemeSwatchOption; group: ThemeGroup }) {
  return (
    <IconButton
      accessibilityRole="radio"
      accessibilityLabel={swatch.label}
      accessibilityState={{ checked: swatch.selected }}
      onPress={() => void setThemeSwatch(group, swatch.id, showAlert)}
      depth={0.04}
      className="items-center justify-center"
      style={{ width: TARGET, height: TARGET }}
    >
      <SwatchDot swatch={swatch} />
    </IconButton>
  );
}

/** A saved colour's spoken name: its place in the row and its hex. */
/** A saved colour's long-press menu: Remove, which leaves the colours in use as they are. */
function SavedColourMenu({
  group,
  swatch,
  label,
  close,
}: {
  group: InkGroup;
  swatch: SavedSwatchOption;
  label: string;
  close: () => void;
}) {
  const { strings } = useLocalisation();
  return (
    <>
      <CardHeading>
        <View
          className="rounded-full border border-separator"
          style={{ width: CELL * 5, height: CELL * 5, backgroundColor: swatch.colour }}
        />
        <Text numberOfLines={1} className="flex-1 font-sans text-body font-medium text-foreground">
          {label}
        </Text>
      </CardHeading>
      <MenuChoices
        cards={[]}
        entries={[
          {
            action: "removeColour",
            label: strings.settings.remove,
            onPress: () => {
              close();
              removeSavedInk(group, swatch.hex);
            },
          },
        ]}
      />
    </>
  );
}

/** A saved colour, as it applies: a tap applies it, a long press offers Remove. */
function SavedSwatch({
  swatch,
  group,
  index,
}: {
  swatch: SavedSwatchOption;
  group: InkGroup;
  index: number;
}) {
  const { strings } = useLocalisation();
  const label = strings.settings.savedColour(index + 1, swatch.hex);
  return (
    <IconButton
      accessibilityRole="radio"
      accessibilityLabel={label}
      accessibilityHint={strings.settings.longpressToRemoveIt}
      accessibilityState={{ checked: swatch.selected }}
      onPress={() => void setSavedInk(group, swatch.hex, showAlert)}
      onLongPress={() =>
        openOverlay({
          label,
          anchor: pressedRect(),
          render: (close) => (
            <SavedColourMenu group={group} swatch={swatch} label={label} close={close} />
          ),
        })
      }
      depth={0.04}
      className="items-center justify-center"
      style={{ width: TARGET, height: TARGET }}
    >
      <SwatchDot swatch={swatch} />
    </IconButton>
  );
}

/** The rainbow rim round a picked custom colour. */
const RIM = 4;

/**
 * The swatch that ends Primary and Secondary: a hue wheel until a colour is
 * picked (and while a saved swatch shows it), then that colour (as it
 * applies) inside a rainbow rim. It opens the colour picker on the picked
 * colour, or else on the row's current one.
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
  const { strings } = useLocalisation();
  const r = SWATCH / 2;
  return (
    <IconButton
      accessibilityRole="radio"
      accessibilityLabel={strings.settings.customColour}
      accessibilityHint={strings.settings.opensTheColourPicker}
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

/**
 * Settings › Appearance › Theme: a background per scheme from swatches, and
 * Primary and Secondary from Default, their saved colours and Custom.
 */
export function ThemeSettingsSection() {
  const { strings } = useLocalisation();
  const state = useThemeState();
  const { choice } = state;
  const scheme = useColorScheme() === "dark" ? "dark" : "light";
  const rows = themeSwatchRows(choice, scheme, strings);

  return (
    <View>
      <CatalogLine className="mb-2">{strings.settings.theme}</CatalogLine>
      <Hairline />
      {rows.map((row) => {
        const chosen = row.swatches.find((swatch) => swatch.selected);
        const saved = row.saved.find((swatch) => swatch.selected);
        const { custom, group } = row;
        return (
          <View key={row.group}>
            <View
              className="pt-3"
              accessibilityRole="radiogroup"
              accessibilityLabel={ROW_LABEL[row.group](strings)}
            >
              <View className="flex-row items-baseline">
                <Text className="flex-1 font-sans text-title3 font-normal text-foreground">
                  {ROW_LABEL[row.group](strings)}
                </Text>
                <Text className="font-sans text-subheadline text-secondary">
                  {custom?.selected
                    ? strings.settings.custom
                    : saved !== undefined
                      ? strings.settings.saved
                      : chosen?.label}
                </Text>
              </View>
              <View className="-mx-1.5 flex-row flex-wrap py-1">
                {row.swatches.map((swatch) => (
                  <Swatch key={swatch.id} swatch={swatch} group={row.group} />
                ))}
                {custom !== null && (group === "primary" || group === "secondary") ? (
                  <>
                    {row.saved.map((swatch, index) => (
                      <SavedSwatch key={swatch.hex} swatch={swatch} group={group} index={index} />
                    ))}
                    <CustomSwatch
                      custom={custom}
                      group={group}
                      current={custom.colour ?? saved?.hex ?? chosen?.colour ?? "#000000"}
                    />
                  </>
                ) : null}
              </View>
            </View>
            <Hairline />
          </View>
        );
      })}
      <Text className="mt-2 font-sans text-footnote text-secondary">
        {strings.settings.cardsGroupsSeparatorsAndTextFollowThe}
      </Text>
      <View className="mt-4 items-start">
        <TextButton
          label={strings.settings.resetToDefaults}
          disabled={isDefaultThemeState(state)}
          onPress={() => void resetTheme(showAlert)}
        />
      </View>
    </View>
  );
}
