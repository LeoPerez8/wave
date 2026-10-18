import { SettingsPageScreen } from "@/settings/SettingsPage";
import { SpotifySettingsSection } from "@/settings/SpotifySettingsSection";
import { WaveAccountSettingsSection } from "@/settings/WaveAccountSettingsSection";
import { YtMusicSettingsSection } from "@/settings/YtMusicSettingsSection";

/** Settings › Accounts: YT Music, Spotify and the Wave account, with the missing songs' downloads. */
export default function AccountsSettingsScreen() {
  return (
    <SettingsPageScreen page="accounts">
      <YtMusicSettingsSection />
      <SpotifySettingsSection />
      <WaveAccountSettingsSection />
    </SettingsPageScreen>
  );
}
