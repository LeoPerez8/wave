import {
  PLAYLIST_LAYOUTS,
  parsePlaylistLayout,
  storedPlaylistLayout,
  type PlaylistLayout,
} from "@wave/core";

import type { TitleLongPress } from "@/components/TitleLongPress";
import { persistedSetting } from "@/lib/persistedSetting";
import { openTitleChoiceGroups, titleChoiceGroup, type CardGroup } from "@/overlay/titleChoices";

import { playlistSortGroup } from "./playlistSort";

const playlistLayout = persistedSetting<PlaylistLayout>({
  key: "settings.playlistLayout",
  read: parsePlaylistLayout,
  write: storedPlaylistLayout,
});

/** How the Playlists list shows playlists (a list until changed); re-renders when it changes. */
export const usePlaylistLayout = playlistLayout.useValue;

const LAYOUT_CHOICES = PLAYLIST_LAYOUTS.map(({ layout, label }) => ({ value: layout, label }));

/** The Playlists title card's layouts, the current one checked. */
const playlistLayoutGroup = (): CardGroup =>
  titleChoiceGroup({
    choices: LAYOUT_CHOICES,
    current: playlistLayout.get(),
    choose: playlistLayout.set,
  });

/**
 * The Playlists title's long press: a card of the layouts, then Sort by's
 * sorts, the current ones checked. Picking one switches every Playlists list
 * at once and keeps it across restarts.
 */
export const playlistLayoutTitleLongPress: TitleLongPress = {
  label: "Choose how playlists show",
  open: () =>
    openTitleChoiceGroups({
      label: "Show and sort playlists",
      groups: [playlistLayoutGroup(), playlistSortGroup()],
    }),
};
