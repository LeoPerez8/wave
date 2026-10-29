import {
  editNowPlayingButtons,
  readNowPlayingButtons,
  storedNowPlayingButtons,
  type NowPlayingAction,
  type NowPlayingButtons,
  type NowPlayingButtonsEdit,
  type NowPlayingSlot,
} from "@wave/core";

import { persistedSetting, sameFields } from "@/lib/persistedSetting";

/**
 * Now Playing's four button slots, left of Queue (Settings › Layout › Now
 * Playing). Synced with the Wave account, as the tab bar is.
 */
const nowPlayingButtons = persistedSetting<NowPlayingButtons>({
  key: "settings.nowPlayingButtons",
  synced: true,
  read: readNowPlayingButtons,
  write: storedNowPlayingButtons,
  equals: sameFields,
});

/** The four slots; re-renders when one changes. */
export const useNowPlayingButtons = nowPlayingButtons.useValue;

/** Applies [edit] (a slot set, swapping a taken action, or Reset to Default) and saves it at once. */
export const editSavedNowPlayingButtons = (edit: NowPlayingButtonsEdit): void =>
  nowPlayingButtons.set(editNowPlayingButtons(nowPlayingButtons.get(), edit));

/** What each action is called on Settings' rows and pickers. */
const ACTION_LABELS: Readonly<Record<NowPlayingAction, string>> = {
  lyrics: "Lyrics",
  sleepTimer: "Sleep Timer",
  addToPlaylist: "Add to Playlist",
  download: "Download",
  shuffle: "Shuffle",
  repeat: "Repeat",
  share: "Share",
  songMenu: "Song Menu",
};

/** A slot's name for what it holds: its action's, or None. */
export const nowPlayingSlotLabel = (slot: NowPlayingSlot): string =>
  slot === null ? "None" : ACTION_LABELS[slot];
