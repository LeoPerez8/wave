import { useScreenContent } from "@/lib/screenTiming";
import { SettingsPageScreen } from "@/settings/SettingsPage";
import { SongLinksSettingsSection } from "@/settings/SongLinksSettingsSection";
import { SpotifySettingsSection } from "@/settings/SpotifySettingsSection";
import { WaveAccountSettingsSection } from "@/settings/WaveAccountSettingsSection";
import { YtMusicSettingsSection } from "@/settings/YtMusicSettingsSection";

/**
 * Settings › Accounts: YT Music, Spotify, whether their song links open Wave, and the Wave
 * account, with the missing songs' downloads.
 */
export default function AccountsSettingsScreen() {
  useScreenContent(true);
  return (
    <SettingsPageScreen page="accounts">
      <YtMusicSettingsSection />
      <SpotifySettingsSection />
      <SongLinksSettingsSection />
      <WaveAccountSettingsSection />
    </SettingsPageScreen>
  );
}
