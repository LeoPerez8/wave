import { entryDivider, NOW_PLAYING_ACTIONS } from "@wave/core";
import * as Haptics from "expo-haptics";
import type { ComponentProps } from "react";
import { View } from "react-native";

import { EntryRow } from "@/catalog/EntryRow";
import type { Press } from "@/motion/Press";
import { pressedRect } from "@/motion/pressedRect";
import { CardEntries } from "@/overlay/CardEntries";
import { useOverlayFlow } from "@/overlay/flow";
import { openOverlay } from "@/overlay/overlay";
import { useSlideToChoose } from "@/overlay/useSlideToChoose";
import {
  editSavedNowPlayingButtons,
  nowPlayingSlotLabel,
  useNowPlayingButtons,
} from "@/settings/nowPlayingButtons";

/** What a slot's button takes so a long press, or the screen reader's action, changes it. */
export type SlotChange = Required<
  Pick<
    ComponentProps<typeof Press>,
    "onLongPress" | "accessibilityActions" | "onAccessibilityAction"
  >
>;

/**
 * The card that changes slot [slot]'s button (0 for the first): the eight
 * actions, the one it holds checked. Opened by a long press, the finger can
 * slide onto an entry and lift to pick it, or tap one after lifting. An
 * action another slot holds swaps the two (Core's `editNowPlayingButtons`).
 * None is only offered in Settings.
 */
function ChangeSlotMenu({ slot, close }: { slot: number; close: () => void }) {
  const held = useNowPlayingButtons()[slot];
  const flow = useOverlayFlow();
  const choose = (index: number) => {
    const action = NOW_PLAYING_ACTIONS[index];
    if (action === undefined) return;
    close();
    editSavedNowPlayingButtons({ slot, action });
  };
  const { underFinger, trackEntry, trackList } = useSlideToChoose(choose);
  return (
    <CardEntries listRef={trackList}>
      {NOW_PLAYING_ACTIONS.map((action, index) => (
        <View key={action} ref={trackEntry(index)} collapsable={false}>
          <EntryRow
            label={nowPlayingSlotLabel(action)}
            selected={action === held}
            divider={entryDivider(index, NOW_PLAYING_ACTIONS.length, flow)}
            highlighted={index === underFinger}
            onPress={() => choose(index)}
          />
        </View>
      ))}
    </CardEntries>
  );
}

/** Opens slot [slot]'s card next to the button whose long press calls it. */
const openChangeSlotMenu = (slot: number): void => {
  openOverlay({
    label: "Change Button",
    anchor: pressedRect(),
    render: (close) => <ChangeSlotMenu slot={slot} close={close} />,
  });
};

/**
 * Slot [slot]'s long press: the long-press haptic and its card, anchored to
 * the button and highlighting it. Screen readers get it as "Change Button".
 */
export const slotChange = (slot: number): SlotChange => ({
  onLongPress: () => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    openChangeSlotMenu(slot);
  },
  accessibilityActions: [{ name: "changeButton", label: "Change Button" }],
  onAccessibilityAction: ({ nativeEvent: { actionName } }) => {
    if (actionName === "changeButton") openChangeSlotMenu(slot);
  },
});
