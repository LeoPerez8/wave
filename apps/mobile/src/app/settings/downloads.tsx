import { DownloadsList } from "@/settings/DownloadsList";
import { DownloadsSettingsSection } from "@/settings/DownloadsSettingsSection";
import { FailedDownloadsSection } from "@/settings/FailedDownloadsSection";
import { SECTION_GAP, SettingsEditorScreen } from "@/settings/SettingsPage";

/**
 * Settings › Downloads: where downloads come from, the songs on their way, then the songs whose
 * download failed, on one virtualized list (hundreds of songs can be waiting).
 */
export default function DownloadsSettingsScreen() {
  return (
    <SettingsEditorScreen page="downloads">
      <DownloadsList
        header={<DownloadsSettingsSection />}
        footer={<FailedDownloadsSection style={{ marginTop: SECTION_GAP }} />}
      />
    </SettingsEditorScreen>
  );
}
