import { DownloadsSettingsSection } from "@/settings/DownloadsSettingsSection";
import { FailedDownloadsSection } from "@/settings/FailedDownloadsSection";
import { QueuedDownloadsSection } from "@/settings/QueuedDownloadsSection";
import { SettingsPageScreen } from "@/settings/SettingsPage";

/**
 * Settings › Downloads: where downloads come from, the songs on their way, then the songs whose
 * download failed.
 */
export default function DownloadsSettingsScreen() {
  return (
    <SettingsPageScreen page="downloads">
      <DownloadsSettingsSection />
      <QueuedDownloadsSection />
      <FailedDownloadsSection />
    </SettingsPageScreen>
  );
}
