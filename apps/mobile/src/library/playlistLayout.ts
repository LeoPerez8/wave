import {
  PLAYLIST_LAYOUTS,
  parsePlaylistLayout,
  storedPlaylistLayout,
  type PlaylistLayout,
} from "@wave/core";

import type { TitleLongPress } from "@/components/TitleLongPress";
import { persistedSetting } from "@/lib/persistedSetting";
import { openTitleChoices } from "@/overlay/titleChoices";

const playlistLayout = persistedSetting<PlaylistLayout>({
  key: "settings.playlistLayout",
  read: parsePlaylistLayout,
  write: storedPlaylistLayout,
});

/** How the Playlists list shows playlists (a list until changed); re-renders when it changes. */
export const usePlaylistLayout = playlistLayout.useValue;

const LAYOUT_CHOICES = PLAYLIST_LAYOUTS.map(({ layout, label }) => ({ value: layout, label }));

/**
 * The Playlists title's long press: a card of the layouts, the current one
 * checked. Picking one switches every Playlists list at once and keeps it
 * across restarts.
 */
export const playlistLayoutTitleLongPress: TitleLongPress = {
  label: "Choose how playlists show",
  open: () =>
    openTitleChoices({
      label: "Show playlists as",
      choices: LAYOUT_CHOICES,
      current: playlistLayout.get(),
      choose: playlistLayout.set,
    }),
};
