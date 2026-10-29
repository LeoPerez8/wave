import { useLocalisation } from "@/localisation/localisation";
import {
  BOUNCE_AMOUNT,
  sampleSwipeActions,
  swipeActionLabels,
  type RowMenuAction,
} from "@wave/core";
import { useMemo, useState } from "react";
import { Text, View } from "react-native";
import { useReducedMotion } from "react-native-reanimated";

import { CatalogLine } from "@/catalog/CatalogLine";
import { Hairline } from "@/catalog/Hairline";
import { SwipeableRow, type RowSwipe, type SwipeSide } from "@/catalog/SwipeableRow";
import { SettingsSlider } from "@/components/SettingsSlider";

import { setBounceAmount, useBounceAmount } from "./bounceAmount";
import { SampleSongRow } from "./SampleSongRow";
import { useSwipeSettings } from "./swipeActions";

const percent = (value: number) => `${value}%`;
const nothing = (): void => undefined;

/** A side of the sample's swipe: what it uncovers, running nothing. */
const sampleSide = (action: RowMenuAction | null): SwipeSide | null =>
  action === null ? null : { action, ...swipeActionLabels(action), leaves: false, run: nothing };

/**
 * Bounce amount's sample: the sample song row on the real swipe gesture,
 * uncovering what Settings › Swipe actions set, springing back at the
 * current amount and running nothing. Each change of [demo] plays one demo
 * swipe and spring.
 */
function BounceSample({ demo }: { demo: number }) {
  const { strings } = useLocalisation();
  const settings = useSwipeSettings();
  const swipe = useMemo((): RowSwipe => {
    const { right, left } = sampleSwipeActions(settings);
    return { right: sampleSide(right), left: sampleSide(left) };
  }, [settings]);
  return (
    <SwipeableRow swipe={swipe} sample demo={demo}>
      <SampleSongRow accessibilityHint={strings.settings.showsTheBounceWhenSwipedItPlays} />
    </SwipeableRow>
  );
}

/**
 * Settings › Appearance › Motion: how elastic pulls and swipes are, with a
 * sample row under the slider that plays one demo swipe whenever the finger
 * leaves the slider (not under reduce motion, where a line says why nothing
 * bounces).
 */
export function MotionSettingsSection() {
  const { strings } = useLocalisation();
  const bounce = useBounceAmount();
  const reduceMotion = useReducedMotion();
  const [demo, setDemo] = useState(0);
  return (
    <View>
      <CatalogLine className="mb-2">{strings.settings.motion}</CatalogLine>
      <Hairline />
      <SettingsSlider
        label={strings.settings.bounceAmount}
        value={bounce}
        range={BOUNCE_AMOUNT}
        format={percent}
        onChange={setBounceAmount}
        onRelease={() => setDemo((count) => count + 1)}
      />
      <BounceSample demo={demo} />
      <Hairline />
      {reduceMotion && (
        <Text className="mt-2 font-sans text-footnote text-secondary">
          {strings.settings.androidsRemoveAnimationsIsOnSoNothing}
        </Text>
      )}
      <Text className="mt-2 font-sans text-footnote text-secondary">
        {strings.settings.bounceFootnote(BOUNCE_AMOUNT.default)}
      </Text>
    </View>
  );
}
