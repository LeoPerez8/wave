import { useScreenContent } from "@/lib/screenTiming";
import { playlistLayoutChoice, usePlaylistLayout } from "@/library/playlistLayout";
import { playlistSortChoice, usePlaylistSort } from "@/library/playlistSort";
import { ChoiceSection } from "@/settings/ChoiceRow";
import { SettingsPageScreen } from "@/settings/SettingsPage";

/**
 * Settings › Layout › Playlists: how the Playlists list shows playlists and
 * how it sorts them, as its title's long press offers. Each option is a
 * section of its own.
 */
export default function PlaylistsLayoutSettingsScreen() {
  useScreenContent(true);
  return (
    <SettingsPageScreen layoutPage="playlists">
      <ChoiceSection choice={playlistLayoutChoice} current={usePlaylistLayout()} />
      <ChoiceSection choice={playlistSortChoice} current={usePlaylistSort()} />
    </SettingsPageScreen>
  );
}
