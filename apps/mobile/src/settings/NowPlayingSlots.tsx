import { NOW_PLAYING_ACTIONS, storedNowPlayingButtons, type NowPlayingSlot } from "@wave/core";
import { Text, View } from "react-native";

import { Hairline } from "@/catalog/Hairline";
import { TextButton } from "@/components/TextButton";
import { router } from "@/lib/timingRouter";

import { ChoiceRow } from "./ChoiceRow";
import {
  editSavedNowPlayingButtons,
  nowPlayingSlotLabel,
  useNowPlayingButtons,
} from "./nowPlayingButtons";
import { SettingsPageRow, SettingsPageScreen } from "./SettingsPage";

/** A slot's name on its row and its picker's header: "Slot 1" for the leftmost. */
const slotTitle = (slot: number): string => `Slot ${slot + 1}`;

/** Where slot [slot]'s picker is (also `wave://settings/layout/now-playing/<n>`). */
const pickerRoute = (slot: number) => `/settings/layout/now-playing/${slot + 1}` as const;

/**
 * Settings › Layout › Now Playing's buttons: a row per slot saying what it
 * holds, each opening its picker, then Reset to Default (off while the row is
 * today's).
 */
export function NowPlayingSlotsSection() {
  const buttons = useNowPlayingButtons();
  return (
    <View>
      <Hairline />
      {buttons.map((action, slot) => (
        <SettingsPageRow
          key={slot}
          title={slotTitle(slot)}
          summary={nowPlayingSlotLabel(action)}
          onPress={() => router.push(pickerRoute(slot))}
        />
      ))}
      <Text className="mt-2 font-sans text-footnote text-secondary">
        Now Playing&apos;s bottom row, left to right, with Queue always on the right. A slot set to
        None leaves the row, and the other buttons spread out.
      </Text>
      <View className="mt-4 items-start">
        <TextButton
          label="Reset to Default"
          disabled={storedNowPlayingButtons(buttons) === null}
          onPress={() => editSavedNowPlayingButtons("reset")}
        />
      </View>
    </View>
  );
}

/** Every choice a slot's picker lists: None, then each action. */
const SLOT_CHOICES: readonly NowPlayingSlot[] = [null, ...NOW_PLAYING_ACTIONS];

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
  const title = slotTitle(slot);
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
                    : `${label}, ${title}, swaps with ${slotTitle(holder)}`
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
          A button another slot holds swaps places with this slot&apos;s.
        </Text>
      </View>
    </SettingsPageScreen>
  );
}
