import { Text, View } from "react-native";

import { CatalogLine } from "@/catalog/CatalogLine";
import { Hairline } from "@/catalog/Hairline";
import { SettingsSlider } from "@/components/SettingsSlider";

import { setTapAnimationMs, TAP_ANIMATION, useTapAnimationMs } from "./tapAnimation";

/** Settings › Appearance › Motion: how long a tap's press animation takes. */
export function MotionSettingsSection() {
  const ms = useTapAnimationMs();
  return (
    <View>
      <CatalogLine className="mb-2">Motion</CatalogLine>
      <Hairline />
      <SettingsSlider
        label="Tap animation"
        value={ms}
        range={TAP_ANIMATION}
        format={(value) => `${value} ms`}
        onChange={setTapAnimationMs}
      />
      <Hairline />
      <Text className="mt-2 font-sans text-footnote text-secondary">
        How long a tap takes to sink and settle. 0 ms turns the animation off; the default is{" "}
        {TAP_ANIMATION.default} ms.
      </Text>
    </View>
  );
}
