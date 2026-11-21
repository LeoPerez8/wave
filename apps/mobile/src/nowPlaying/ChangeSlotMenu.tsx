import { currentLocalisation } from "@/localisation/localisation";
import { entryDivider, nowPlayingSlotChoices, type NowPlayingSlot } from "@wave/core";
import * as Haptics from "expo-haptics";
import type { ComponentProps } from "react";

import { EntryRow } from "@/catalog/EntryRow";
import type { Press } from "@/motion/Press";
import { pressedRect } from "@/motion/pressedRect";
import { CardEntries } from "@/overlay/CardEntries";
import { useOverlayFlow } from "@/overlay/flow";
import { openOverlay } from "@/overlay/overlay";
import {
  editSavedNowPlayingButtons,
  nowPlayingSlotLabel,
  nowPlayingSlotCaption,
  useNowPlayingButtons,
} from "@/settings/nowPlayingButtons";

/** What a slot's button takes so a long press, or the screen reader's action, starts edit mode. */
export type SlotChange = Required<
  Pick<
    ComponentProps<typeof Press>,
    "onLongPress" | "accessibilityActions" | "onAccessibilityAction"
  >
>;

/** Every choice a slot's card lists: None, then each action, as its picker in Settings does. */
const CHOICES: readonly NowPlayingSlot[] = [null, ...nowPlayingSlotChoices()];

/**
 * The card that changes slot [slot] (0 for the first), opened by a tap on it
 * in edit mode: None, then the actions a slot can hold (Core's
 * `nowPlayingSlotChoices`), the one it holds checked. A pick is saved at
 * once and shows on the player; an action another slot holds is captioned
 * with that slot's place, read with its name, and swaps the two (Core's
 * `editNowPlayingButtons`).
 */
function ChangeSlotMenu({ slot, close }: { slot: number; close: () => void }) {
  const buttons = useNowPlayingButtons();
  const held = buttons[slot];
  const flow = useOverlayFlow();
  return (
    <CardEntries>
      {CHOICES.map((action, index) => {
        const caption = nowPlayingSlotCaption(buttons, slot, action);
        return (
          <EntryRow
            key={action ?? "none"}
            label={nowPlayingSlotLabel(action)}
            line={caption}
            lineShown={caption !== undefined}
            lineRead="label"
            selected={action === held}
            divider={entryDivider(index, CHOICES.length, flow)}
            onPress={() => {
              close();
              editSavedNowPlayingButtons({ slot, action });
            }}
          />
        );
      })}
    </CardEntries>
  );
}

/** Opens slot [slot]'s card next to the slot whose tap calls it. */
export const openChangeSlotMenu = (slot: number): void => {
  openOverlay({
    label: currentLocalisation().strings.playbackText.changeButton,
    anchor: pressedRect(),
    render: (close) => <ChangeSlotMenu slot={slot} close={close} />,
  });
};

/**
 * A slot's long press: the long-press haptic, then edit mode ([edit]).
 * Screen readers get it as "Edit Buttons".
 */
export const slotEdit = (edit: () => void): SlotChange => ({
  onLongPress: () => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    edit();
  },
  accessibilityActions: [
    { name: "editButtons", label: currentLocalisation().strings.playbackText.editButtons },
  ],
  onAccessibilityAction: ({ nativeEvent: { actionName } }) => {
    if (actionName === "editButtons") edit();
  },
});
