import { currentLocalisation } from "@/localisation/localisation";
import {
  NOW_PLAYING_BUTTONS_KEY,
  NOW_PLAYING_PREVIOUS_ROW_KEY,
  editNowPlayingButtons,
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
};

/** A slot's name for what it holds: its action's, or None. */
export const nowPlayingSlotLabel = (slot: NowPlayingSlot): string =>
  slot === null ? currentLocalisation().strings.playbackText.none : ACTION_LABELS[slot];
