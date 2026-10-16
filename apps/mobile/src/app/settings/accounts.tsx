import { SettingsPageScreen } from "@/settings/SettingsPage";
import { WaveAccountSettingsSection } from "@/settings/WaveAccountSettingsSection";
import { YtMusicSettingsSection } from "@/settings/YtMusicSettingsSection";

/** Settings › Accounts: YT Music and the Wave account, with the missing songs' downloads. */
export default function AccountsSettingsScreen() {
  return (
    <SettingsPageScreen page="accounts">
      <YtMusicSettingsSection />
      <WaveAccountSettingsSection />
    </SettingsPageScreen>
  );
}
