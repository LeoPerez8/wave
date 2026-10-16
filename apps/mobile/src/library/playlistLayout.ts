import {
  PLAYLIST_LAYOUTS,
  parsePlaylistLayout,
  storedPlaylistLayout,
  type PlaylistLayout,
} from "@wave/core";

import type { TitleLongPress } from "@/components/TitleLongPress";
import { persistedSetting } from "@/lib/persistedSetting";
import { openTitleChoices } from "@/overlay/titleChoices";
import type { ChoiceSetting } from "@/settings/ChoiceRow";

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
  label: "Show playlists as",
  choices: PLAYLIST_LAYOUTS.map(({ layout, label }) => ({ value: layout, label })),
  setting: playlistLayout,
};

/**
 * The Playlists title's long press: a card of the layouts, the current one
 * checked. Picking one switches every Playlists list at once and keeps it
 * across restarts.
 */
export const playlistLayoutTitleLongPress: TitleLongPress = {
  label: "Choose how playlists show",
  open: () =>
    openTitleChoices({
      label: playlistLayoutChoice.label,
      choices: playlistLayoutChoice.choices,
      current: playlistLayout.get(),
      choose: playlistLayout.set,
    }),
};
