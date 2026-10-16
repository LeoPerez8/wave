import { playlistLayoutChoice, usePlaylistLayout } from "@/library/playlistLayout";
import { ChoiceSection } from "@/settings/ChoiceRow";
import { SettingsPageScreen } from "@/settings/SettingsPage";

/**
 * Settings › Layout › Playlists: how the Playlists list shows playlists, as
 * its title's long press offers. Each option is a section of its own.
 */
export default function PlaylistsLayoutSettingsScreen() {
  return (
    <SettingsPageScreen layoutPage="playlists">
      <ChoiceSection choice={playlistLayoutChoice} current={usePlaylistLayout()} />
    </SettingsPageScreen>
  );
}
