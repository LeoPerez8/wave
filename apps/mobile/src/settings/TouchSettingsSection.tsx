import { useLocalisation } from "@/localisation/localisation";
import { useState } from "react";
import { Text, View } from "react-native";
import { useReducedMotion } from "react-native-reanimated";

import { CatalogLine } from "@/catalog/CatalogLine";
import { Hairline } from "@/catalog/Hairline";
import { SettingsSlider } from "@/components/SettingsSlider";

import { LongPressSample } from "./LongPressSample";
import { LONG_PRESS_DELAY, setLongPressDelayMs, useLongPressDelayMs } from "./longPressDelay";

/**
 * Settings › Appearance › Touch: how long a hold takes to open a menu, with
 * a sample row under the slider to hold, whose fill sweeps once over the new
 * delay whenever the finger leaves the slider (not under reduce motion, where
 * a line says why nothing fills).
 */
export function TouchSettingsSection() {
  const { strings } = useLocalisation();
  const ms = useLongPressDelayMs();
  const reduceMotion = useReducedMotion();
  const [demo, setDemo] = useState(0);
  return (
    <View>
      <CatalogLine className="mb-2">{strings.settings.touch}</CatalogLine>
      <Hairline />
      <SettingsSlider
        label={strings.settings.longpressDelay}
        value={ms}
        range={LONG_PRESS_DELAY}
        format={(value) => `${value} ms`}
        onChange={setLongPressDelayMs}
        onRelease={() => setDemo((count) => count + 1)}
      />
      <LongPressSample demo={demo} />
      <Hairline />
      {reduceMotion && (
        <Text className="mt-2 font-sans text-footnote text-secondary">
          {strings.settings.androidsRemoveAnimationsIsOnSoThe}
        </Text>
      )}
      <Text className="mt-2 font-sans text-footnote text-secondary">
        {strings.settings.longPressFootnote(LONG_PRESS_DELAY.default)}
      </Text>
    </View>
  );
}
