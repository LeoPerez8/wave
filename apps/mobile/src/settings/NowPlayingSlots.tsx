import { useLocalisation } from "@/localisation/localisation";
import {
  nowPlayingButtonsAreDefault,
  nowPlayingSlotChoices,
  nowPlayingSlotRoute,
  type NowPlayingSlot,
} from "@wave/core";
import { Text, View } from "react-native";

import { Hairline } from "@/catalog/Hairline";
import { TextButton } from "@/components/TextButton";
import { router } from "@/lib/timingRouter";

import { ChoiceRow } from "./ChoiceRow";
import {
  editSavedNowPlayingButtons,
  nowPlayingSlotLabel,
  nowPlayingSlotTitle,
  useNowPlayingButtons,
} from "./nowPlayingButtons";
import { SettingsPageRow, SettingsPageScreen } from "./SettingsPage";

/**
 * Where slot [slot]'s picker is (also `wave://settings/layout/now-playing/<n>`,
 * `left` and `right` for the transport's).
 */
const pickerRoute = (slot: number) =>
  `/settings/layout/now-playing/${nowPlayingSlotRoute(slot) ?? ""}` as const;

/**
 * Settings › Layout › Now Playing's buttons: a row per slot saying what it
 * holds (the footer's five, then the transport's two), each opening its
 * picker, then Reset to Default (off while the slots are the default).
 */
export function NowPlayingSlotsSection() {
  const { strings } = useLocalisation();
  const buttons = useNowPlayingButtons();
  return (
    <View>
      <Hairline />
      {buttons.map((action, slot) => (
        <SettingsPageRow
          key={slot}
          title={nowPlayingSlotTitle(slot)}
          summary={nowPlayingSlotLabel(action)}
          onPress={() => router.push(pickerRoute(slot))}
        />
      ))}
      <Text className="mt-2 font-sans text-footnote text-secondary">
        {strings.settings.nowPlayingsBottomRowLeftToRight}
      </Text>
      <View className="mt-4 items-start">
        <TextButton
          label={strings.settings.resetToDefault}
          disabled={nowPlayingButtonsAreDefault(buttons)}
          onPress={() => editSavedNowPlayingButtons("reset")}
        />
      </View>
    </View>
  );
}

/** Every choice a slot's picker lists: None, then each action. */
const SLOT_CHOICES: readonly NowPlayingSlot[] = [null, ...nowPlayingSlotChoices()];

/** Back to Now Playing's page, there being nothing under a picker opened from a link. */
const closePicker = (): void => {
  if (router.canGoBack()) router.back();
  else router.replace("/settings/layout/now-playing");
};

/**
 * Slot [slot]'s picker (0 for Slot 1): None, then each action, the one it
 * holds checked. A tap saves it at once and goes back; an action another
 * slot holds swaps into that slot's place. Back leaves it as it was.
 */
export function NowPlayingSlotPickerScreen({ slot }: { slot: number }) {
  const { strings } = useLocalisation();
  const title = nowPlayingSlotTitle(slot);
  const buttons = useNowPlayingButtons();
  const chosen = buttons[slot];
  return (
    <SettingsPageScreen title={title}>
      <View>
        <Hairline />
        <View accessibilityRole="radiogroup" accessibilityLabel={title}>
          {SLOT_CHOICES.map((choice) => {
            const label = nowPlayingSlotLabel(choice);
            const holder = choice === null ? -1 : buttons.indexOf(choice);
            return (
              <ChoiceRow
                key={label}
                label={label}
                accessibilityLabel={
                  holder === -1 || holder === slot
                    ? `${label}, ${title}`
                    : strings.settings.swapSlot(label, title, nowPlayingSlotTitle(holder))
                }
                chosen={choice === chosen}
                onPress={() => {
                  editSavedNowPlayingButtons({ slot, action: choice });
                  closePicker();
                }}
              />
            );
          })}
        </View>
        <Text className="mt-2 font-sans text-footnote text-secondary">
          {strings.settings.aButtonAnotherSlotHoldsSwapsPlaces}
        </Text>
      </View>
    </SettingsPageScreen>
  );
}
