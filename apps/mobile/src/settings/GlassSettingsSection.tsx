import { currentLocalisation, useLocalisation } from "@/localisation/localisation";
import {
  fullGlassNotice,
  GLASS_LEVEL_RANGE,
  glassLevel,
  glassLevelValue,
  isDefaultGlassSettings,
  type GlassLevelSetting,
} from "@wave/core";
import { Text, View } from "react-native";

import { CatalogLine } from "@/catalog/CatalogLine";
import { Hairline } from "@/catalog/Hairline";
import { SettingsSlider } from "@/components/SettingsSlider";
import { SettingsSwitch } from "@/components/SettingsSwitch";
import { TextButton } from "@/components/TextButton";
import { setFullGlass, usePhoneEffectsSession } from "@/glass/phoneEffects";
import { confirmAction } from "@/overlay/alert";

import { GlassSample } from "./GlassSample";
import { resetGlassSettings, setGlassSetting, useGlassSettings } from "./glass";

const dp = (value: number) => `${value} dp`;
const percent = (value: number) => `${value}%`;

type LevelSliderProps = {
  label: string;
  setting: GlassLevelSetting;
  value: number;
  /** The setting's value at a level, as shown beside the label, e.g. "24 dp". */
  format: (value: number) => string;
  /** While the glass is the plain surface: dimmed, not adjustable. */
  disabled: boolean;
};

/** A glass setting's slider: it snaps to the setting's five levels and stores the level's value. */
function GlassLevelSlider({ label, setting, value, format, disabled }: LevelSliderProps) {
  return (
    <SettingsSlider
      label={label}
      value={glassLevel(setting, value)}
      range={GLASS_LEVEL_RANGE}
      format={(level) => format(glassLevelValue(setting, level))}
      onChange={(level) => setGlassSetting(setting, glassLevelValue(setting, level))}
      disabled={disabled}
    />
  );
}

/** Full glass's switch: on asks first, on the app's glass card, what it costs; off asks nothing. */
const changeFullGlass = async (on: boolean): Promise<void> => {
  if (!on) {
    setFullGlass(false);
    return;
  }
  const strings = currentLocalisation().strings.settings.fullGlass;
  const confirmed = await confirmAction({
    title: strings.confirmTitle,
    message: strings.confirmMessage,
    action: { label: strings.turnOn },
  });
  if (confirmed) setFullGlass(true);
};

/**
 * Settings › Appearance › Glass: tunes the glass of the tab bar, mini player,
 * menus and dialogs. On a phone Wave judged weak (#1538) it first says why the
 * glass is the plain surface, and since when, over the Full glass switch; while
 * that's off the sample is the plain surface and the sliders are dimmed.
 */
export function GlassSettingsSection() {
  const { language, strings } = useLocalisation();
  const glass = useGlassSettings();
  const notice = fullGlassNotice(usePhoneEffectsSession(), language);
  const simplified = notice !== null && !notice.on;

  return (
    <View>
      <CatalogLine className="mb-2">{strings.settings.glass}</CatalogLine>
      {notice === null ? null : (
        <View className="mb-3">
          <Text className="font-sans text-subheadline text-secondary">{notice.text}</Text>
          <SettingsSwitch
            label={strings.settings.fullGlass.label}
            value={notice.on}
            onValueChange={(on) => void changeFullGlass(on)}
          />
        </View>
      )}
      <View className="mb-3">
        <GlassSample />
      </View>
      <Hairline />
      <GlassLevelSlider
        label={strings.settings.blur}
        setting="blur"
        value={glass.blur}
        disabled={simplified}
        format={dp}
      />
      <Hairline />
      <GlassLevelSlider
        label={strings.settings.refraction}
        setting="refraction"
        value={glass.refraction}
        disabled={simplified}
        format={(value) => (value === 0 ? strings.settings.off : dp(value))}
      />
      <Hairline />
      <GlassLevelSlider
        label={strings.settings.tint}
        setting="tint"
        value={glass.tint}
        disabled={simplified}
        format={percent}
      />
      <Hairline />
      <GlassLevelSlider
        label={strings.settings.rim}
        setting="rim"
        value={glass.rim}
        disabled={simplified}
        format={(value) => (value === 0 ? strings.settings.off : percent(value))}
      />
      <Hairline />
      <Text className="mt-2 font-sans text-footnote text-secondary">
        {strings.settings.howTheTabBarMiniPlayerMenus}
      </Text>
      <View className="mt-4 items-start">
        <TextButton
          label={strings.settings.resetToDefaults}
          disabled={isDefaultGlassSettings(glass)}
          onPress={resetGlassSettings}
        />
      </View>
    </View>
  );
}
