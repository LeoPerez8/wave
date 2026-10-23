import { useScreenContent } from "@/lib/screenTiming";
import { HomeEditor } from "@/home/HomeEditor";
import { editSavedHomeArrangement, useHomeArrangement } from "@/home/homeArrangement";
import { SettingsEditorScreen } from "@/settings/SettingsPage";

/**
 * Settings › Layout › Home: Home's editor as a page, the one a long press on
 * Home's title opens. Each change is saved as it's made, so Home shows it at
 * once.
 */
export default function HomeLayoutSettingsScreen() {
  useScreenContent(true);
  return (
    <SettingsEditorScreen layoutPage="home">
      <HomeEditor arrangement={useHomeArrangement()} edit={editSavedHomeArrangement} />
    </SettingsEditorScreen>
  );
}
