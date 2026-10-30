import { useScreenContent } from "@/lib/screenTiming";
import { ScanProgressBanner } from "@/components/ScanProgressBanner";
import { LibrarySettingsSection } from "@/settings/LibrarySettingsSection";
import { SettingsPageScreen } from "@/settings/SettingsPage";

/** Settings › Library: music folders, skipping voice notes, rescanning (with its progress) and BlackPlayer stats. */
export default function LibrarySettingsScreen() {
  useScreenContent(true);
  return (
    <SettingsPageScreen page="library">
      <ScanProgressBanner />
      <LibrarySettingsSection />
    </SettingsPageScreen>
  );
}
