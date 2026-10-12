import { GLASS_SETTINGS, isDefaultGlassSettings } from "@wave/core";
import { Switch, Text, View } from "react-native";

import { CatalogLine } from "@/catalog/CatalogLine";
import { grid } from "@/catalog/grid";
import { Hairline } from "@/catalog/Hairline";
import { SettingsSlider } from "@/components/SettingsSlider";
import { TextButton } from "@/components/TextButton";
import { useThemeColor } from "@/theme/useThemeColor";

import { resetGlassSettings, setGlassSetting, useGlassSettings } from "./glass";

const dp = (value: number) => `${value} dp`;
const percent = (value: number) => `${value}%`;

/** Settings › Glass: tunes the glass of the tab bar, mini player, menus and dialogs. */
export function GlassSettingsSection() {
  const glass = useGlassSettings();
  const accent = useThemeColor("accent");
  const fill = useThemeColor("fill");
  const surface = useThemeColor("surface");

  return (
    <>
      <CatalogLine className="mb-2 mt-12">Glass</CatalogLine>
      <Hairline />
      <SettingsSlider
        label="Blur"
        value={glass.blur}
        range={GLASS_SETTINGS.blur}
        format={dp}
        onChange={(value) => setGlassSetting("blur", value)}
      />
      <Hairline />
      <SettingsSlider
        label="Refraction"
        value={glass.refraction}
        range={GLASS_SETTINGS.refraction}
        format={(value) => (value === 0 ? "Off" : dp(value))}
        onChange={(value) => setGlassSetting("refraction", value)}
      />
      <Hairline />
      <SettingsSlider
        label="Tint"
        value={glass.tint}
        range={GLASS_SETTINGS.tint}
        format={percent}
        onChange={(value) => setGlassSetting("tint", value)}
      />
      <Hairline />
      <View className="flex-row items-center" style={{ minHeight: grid.row }}>
        <Text className="flex-1 font-sans text-title3 font-normal text-foreground">Rim</Text>
        <Switch
          accessibilityLabel="Rim"
          value={glass.rim}
          onValueChange={(value) => setGlassSetting("rim", value)}
          trackColor={{ false: fill, true: accent }}
          thumbColor={surface}
        />
      </View>
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
    </>
  );
}
