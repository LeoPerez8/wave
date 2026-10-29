import {
  PLAYLIST_LAYOUTS,
  parsePlaylistLayout,
  storedPlaylistLayout,
  type PlaylistLayout,
} from "@wave/core";

import type { TitleLongPress } from "@/components/TitleLongPress";
import { persistedSetting } from "@/lib/persistedSetting";
import { currentLocalisation } from "@/localisation/localisation";
import { openTitleChoiceGroups, titleChoiceGroup } from "@/overlay/titleChoices";
import type { ChoiceSetting } from "@/settings/ChoiceRow";

import { playlistSortChoice } from "./playlistSort";

const playlistLayout = persistedSetting<PlaylistLayout>({
  key: "settings.playlistLayout",
  read: parsePlaylistLayout,
  write: storedPlaylistLayout,
});

/** How the Playlists list shows playlists (a list until changed); re-renders when it changes. */
export const usePlaylistLayout = playlistLayout.useValue;

/**
 * The layouts, offered by the title's long press and by Settings › Layout ›
 * Playlists alike.
 */
export const playlistLayoutChoice: ChoiceSetting<PlaylistLayout> = {
  // Read when shown, so they're in the language Wave reads in.
  get label() {
    return currentLocalisation().strings.playlists.showAs;
  },
  get choices() {
    const { layouts } = currentLocalisation().strings.playlists;
    return PLAYLIST_LAYOUTS.map(({ layout }) => ({ value: layout, label: layouts[layout] }));
  },
  setting: playlistLayout,
};

/**
 * The Playlists title's long press: a card of the layouts, then Sort by's
 * sorts, the current ones checked. Picking one switches every Playlists list
 * at once and keeps it across restarts.
 */
export const playlistLayoutTitleLongPress: TitleLongPress = {
  get label() {
    return currentLocalisation().strings.playlists.chooseLayout;
  },
  open: () =>
    openTitleChoiceGroups({
      label: currentLocalisation().strings.playlists.showAndSort,
      groups: [
        // No heading: the highlighted title says what the card is about.
        titleChoiceGroup({
          choices: playlistLayoutChoice.choices,
          current: playlistLayout.get(),
          choose: playlistLayout.set,
        }),
        titleChoiceGroup({
          heading: playlistSortChoice.label,
          choices: playlistSortChoice.choices,
          current: playlistSortChoice.setting.get(),
          choose: playlistSortChoice.setting.set,
        }),
      ],
    }),
};
