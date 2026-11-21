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
  nowPlayingSlotCaption,
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
 * slot holds is captioned with that slot's place and swaps into it. Back
 * leaves it as it was.
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
            return (
              <ChoiceRow
                key={label}
                label={label}
                line={nowPlayingSlotCaption(buttons, slot, choice)}
                // The caption names where another slot holds it, heard once after the name
                // ("Lyrics, Slot 1, In the footer"); the note under the list says it swaps.
                lineRead="label"
                accessibilityLabel={`${label}, ${title}`}
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
