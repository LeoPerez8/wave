import { useScreenContent } from "@/lib/screenTiming";
import { DownloadsList } from "@/settings/DownloadsList";
import { DownloadsSettingsSection } from "@/settings/DownloadsSettingsSection";
import { SettingsEditorScreen } from "@/settings/SettingsPage";

/**
 * Settings › Downloads: where downloads come from, the songs on their way, then the songs whose
 * download failed, on one virtualized list (hundreds of songs can be waiting or failed).
 */
export default function DownloadsSettingsScreen() {
  useScreenContent(true);
  return (
    <SettingsEditorScreen page="downloads">
      <DownloadsList header={<DownloadsSettingsSection />} />
    </SettingsEditorScreen>
  );
}
