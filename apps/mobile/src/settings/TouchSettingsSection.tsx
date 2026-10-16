import { Text, View } from "react-native";

import { CatalogLine } from "@/catalog/CatalogLine";
import { Hairline } from "@/catalog/Hairline";
import { SettingsSlider } from "@/components/SettingsSlider";

import { LONG_PRESS_DELAY, setLongPressDelayMs, useLongPressDelayMs } from "./longPressDelay";

/** Settings › Appearance › Touch: how long a hold takes to open a menu. */
export function TouchSettingsSection() {
  const ms = useLongPressDelayMs();
  return (
    <View>
      <CatalogLine className="mb-2">Touch</CatalogLine>
      <Hairline />
      <SettingsSlider
        label="Long-press delay"
        value={ms}
        range={LONG_PRESS_DELAY}
        format={(value) => `${value} ms`}
        onChange={setLongPressDelayMs}
      />
      <Hairline />
      <Text className="mt-2 font-sans text-footnote text-secondary">
        How long to hold a song, album or list entry before its menu opens. The default is{" "}
        {LONG_PRESS_DELAY.default} ms.
      </Text>
    </View>
  );
}
