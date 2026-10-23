import { BOUNCE_AMOUNT } from "@wave/core";
import { Text, View } from "react-native";

import { CatalogLine } from "@/catalog/CatalogLine";
import { Hairline } from "@/catalog/Hairline";
import { SettingsSlider } from "@/components/SettingsSlider";
import { TextButton } from "@/components/TextButton";

import { resetBounceAmount, setBounceAmount, useBounceAmount } from "./bounceAmount";
import { setTapAnimationMs, TAP_ANIMATION, useTapAnimationMs } from "./tapAnimation";

const percent = (value: number) => `${value}%`;

/**
 * Settings › Appearance › Motion: how long a tap's press animation takes, and
 * how elastic pulls and swipes are (Bounce amount, with its reset).
 */
export function MotionSettingsSection() {
  const ms = useTapAnimationMs();
  const bounce = useBounceAmount();
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
      <SettingsSlider
        label="Bounce amount"
        value={bounce}
        range={BOUNCE_AMOUNT}
        format={percent}
        onChange={setBounceAmount}
      />
      <Hairline />
      <Text className="mt-2 font-sans text-footnote text-secondary">
        Tap animation is how long a tap takes to sink and settle: 0 ms turns it off; the default is{" "}
        {TAP_ANIMATION.default} ms. Bounce amount is how far Home&apos;s rows give as you pull them
        to refresh, and how far a swiped song, the mini player or a toast springs past its place
        when let go: at 0% pulls and swipes still work, without the bounce; the default is{" "}
        {BOUNCE_AMOUNT.default}%. Android&apos;s Remove animations turns the bounce off.
      </Text>
      <View className="mt-4 items-start">
        <TextButton
          label={`Reset bounce to ${BOUNCE_AMOUNT.default}%`}
          disabled={bounce === BOUNCE_AMOUNT.default}
          onPress={resetBounceAmount}
        />
      </View>
    </View>
  );
}
