import { currentLocalisation } from "@/localisation/localisation";
import {
  NOW_PLAYING_BUTTONS_KEY,
  NOW_PLAYING_PREVIOUS_ROW_KEY,
  NOW_PLAYING_TRANSPORT_SLOTS,
  nowPlayingSlotChoiceHolder,
  editNowPlayingButtons,
  moveNowPlayingButton,
  readNowPlayingButtons,
  storedNowPlayingButtons,
  type NowPlayingAction,
  type NowPlayingButtons,
  type NowPlayingButtonsEdit,
  type NowPlayingSlot,
} from "@wave/core";
import { Storage } from "expo-sqlite/kv-store";

import { persistedSetting, sameFields } from "@/lib/persistedSetting";

/**
 * The row of four slots as stored before there were seven, which Core reads
 * to keep an edited row. This phone never writes it.
 */
const previousRow = (): string | null => Storage.getItemSync(NOW_PLAYING_PREVIOUS_ROW_KEY);

/**
 * Now Playing's seven slots: five in the footer and one on each side of the
 * transport (Settings › Layout › Now Playing). Synced with the Wave account,
 * as the tab bar is, under Core's key.
 */
const nowPlayingButtons = persistedSetting<NowPlayingButtons>({
  key: NOW_PLAYING_BUTTONS_KEY,
  synced: true,
  read: (stored) => readNowPlayingButtons(stored, previousRow()),
  write: (buttons) => storedNowPlayingButtons(buttons, previousRow()),
  equals: sameFields,
});

/** The seven slots; re-renders when one changes. */
export const useNowPlayingButtons = nowPlayingButtons.useValue;

/** The seven slots, as saved. */
export const savedNowPlayingButtons = nowPlayingButtons.get;

/** Applies [edit] (a slot set, swapping a taken action, or Reset to Default) and saves it at once. */
export const editSavedNowPlayingButtons = (edit: NowPlayingButtonsEdit): void =>
  nowPlayingButtons.set(editNowPlayingButtons(nowPlayingButtons.get(), edit));

/** Moves a button between the seven slots and saves it to the synced preference. */
export const moveSavedNowPlayingButton = (from: number, to: number): void =>
  nowPlayingButtons.set(moveNowPlayingButton(nowPlayingButtons.get(), from, to));

/** What each action is called on Settings' rows and pickers. */
const ACTION_LABELS: Readonly<Record<NowPlayingAction, string>> = {
  get lyrics() {
    return currentLocalisation().strings.playbackText.lyrics;
  },
  get queue() {
    return currentLocalisation().strings.playbackText.queue;
  },
  get sleepTimer() {
    return currentLocalisation().strings.playbackText.sleepTimer;
  },
  get addToPlaylist() {
    return currentLocalisation().strings.playbackText.addToPlaylist;
  },
  get download() {
    return currentLocalisation().strings.playbackText.download;
  },
  get shuffle() {
    return currentLocalisation().strings.playbackText.shuffle;
  },
  get repeat() {
    return currentLocalisation().strings.playbackText.repeat;
  },
  get share() {
    return currentLocalisation().strings.playbackText.share;
  },
  get dislike() {
    return currentLocalisation().strings.itemActions.labels.dislike;
  },
  get magicQueue() {
    return currentLocalisation().strings.itemActions.labels.magicQueue;
  },
  get goToArtist() {
    return currentLocalisation().strings.itemActions.labels.goToArtist;
  },
  get goToAlbum() {
    return currentLocalisation().strings.itemActions.labels.goToAlbum;
  },
};

/** A slot's name for what it holds: its action's, or None. */
export const nowPlayingSlotLabel = (slot: NowPlayingSlot): string =>
  slot === null ? currentLocalisation().strings.playbackText.none : ACTION_LABELS[slot];

/**
 * A slot's name on its Settings row, its picker's header and, in edit mode,
 * to screen readers: "Slot 1" to "Slot 5" for the footer's, left to right,
 * and the transport's two by their side.
 */
export const nowPlayingSlotTitle = (slot: number): string => {
  const { settings } = currentLocalisation().strings;
  if (slot === NOW_PLAYING_TRANSPORT_SLOTS.left) return settings.slotLeftOfPrevious;
  if (slot === NOW_PLAYING_TRANSPORT_SLOTS.right) return settings.slotRightOfNext;
  return settings.slot(slot + 1);
};

/**
 * The quiet caption under [action] in slot [slot]'s choices, naming where
 * another slot already holds it ("In the footer", "Beside Next"), or
 * undefined for the slot's own action, a free one and None (Core's
 * `nowPlayingSlotChoiceHolder`).
 */
export const nowPlayingSlotCaption = (
  buttons: readonly NowPlayingSlot[],
  slot: number,
  action: NowPlayingSlot,
): string | undefined => {
  const { settings } = currentLocalisation().strings;
  switch (nowPlayingSlotChoiceHolder(buttons, slot, action)) {
    case "footer":
      return settings.slotInFooter;
    case "previous":
      return settings.slotBesidePrevious;
    case "next":
      return settings.slotBesideNext;
    case null:
      return undefined;
  }
};
