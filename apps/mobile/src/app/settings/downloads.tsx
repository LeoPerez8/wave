import { DownloadsSettingsSection } from "@/settings/DownloadsSettingsSection";
import { FailedDownloadsSection } from "@/settings/FailedDownloadsSection";
import { SettingsPageScreen } from "@/settings/SettingsPage";

/** Settings › Downloads: where downloads come from, then the songs whose download failed. */
export default function DownloadsSettingsScreen() {
  return (
    <SettingsPageScreen page="downloads">
      <DownloadsSettingsSection />
      <FailedDownloadsSection />
    </SettingsPageScreen>
  );
}
