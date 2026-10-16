import { DownloadsSettingsSection } from "@/settings/DownloadsSettingsSection";
import { SettingsPageScreen } from "@/settings/SettingsPage";

/** Settings › Downloads: where downloads come from. */
export default function DownloadsSettingsScreen() {
  return (
    <SettingsPageScreen page="downloads">
      <DownloadsSettingsSection />
    </SettingsPageScreen>
  );
}
