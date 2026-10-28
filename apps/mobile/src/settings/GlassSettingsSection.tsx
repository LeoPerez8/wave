import {
  GLASS_LEVEL_RANGE,
  glassLevel,
  glassLevelValue,
  isDefaultGlassSettings,
  type GlassLevelSetting,
} from "@wave/core";
import { Text, View } from "react-native";

import { CatalogLine } from "@/catalog/CatalogLine";
import { Hairline } from "@/catalog/Hairline";
import { SettingsSwitch } from "@/components/SettingsSwitch";
import { SettingsSlider } from "@/components/SettingsSlider";
import { TextButton } from "@/components/TextButton";

import { resetGlassSettings, setGlassSetting, useGlassSettings } from "./glass";

const dp = (value: number) => `${value} dp`;
const percent = (value: number) => `${value}%`;

type LevelSliderProps = {
  label: string;
  setting: GlassLevelSetting;
  value: number;
  /** The setting's value at a level, as shown beside the label, e.g. "24 dp". */
  format: (value: number) => string;
};

/** A glass setting's slider: it snaps to the setting's five levels and stores the level's value. */
function GlassLevelSlider({ label, setting, value, format }: LevelSliderProps) {
  return (
    <SettingsSlider
      label={label}
      value={glassLevel(setting, value)}
      range={GLASS_LEVEL_RANGE}
      format={(level) => format(glassLevelValue(setting, level))}
      onChange={(level) => setGlassSetting(setting, glassLevelValue(setting, level))}
    />
  );
}

/** Settings › Appearance › Glass: tunes the glass of the tab bar, mini player, menus and dialogs. */
export function GlassSettingsSection() {
  const glass = useGlassSettings();

  return (
    <View>
      <CatalogLine className="mb-2">Glass</CatalogLine>
      <Hairline />
      <GlassLevelSlider label="Blur" setting="blur" value={glass.blur} format={dp} />
      <Hairline />
      <GlassLevelSlider
        label="Refraction"
        setting="refraction"
        value={glass.refraction}
        format={(value) => (value === 0 ? "Off" : dp(value))}
      />
      <Hairline />
      <GlassLevelSlider label="Tint" setting="tint" value={glass.tint} format={percent} />
      <Hairline />
      <SettingsSwitch
        label="Rim"
        value={glass.rim}
        onValueChange={(value) => setGlassSetting("rim", value)}
      />
      <Hairline />
      <Text className="mt-2 font-sans text-footnote text-secondary">
        How the tab bar, mini player, menus and dialogs show what&apos;s behind them. Blur softens
        it, refraction bends it at the edges (off leaves blur, tint and rim), tint lays the surface
        colour over it so text stays legible, and the rim is the bright edge.
      </Text>
      <View className="mt-4 items-start">
        <TextButton
          label="Reset to defaults"
          disabled={isDefaultGlassSettings(glass)}
          onPress={resetGlassSettings}
        />
      </View>
    </View>
  );
}
