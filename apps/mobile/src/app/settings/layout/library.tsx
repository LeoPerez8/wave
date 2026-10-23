import { useScreenContent } from "@/lib/screenTiming";
import { libraryShelfChoice, useLibraryShelf } from "@/library/libraryShelf";
import { ChoiceSection } from "@/settings/ChoiceRow";
import { SettingsPageScreen } from "@/settings/SettingsPage";

/** Settings › Layout › Library: the shelf under the Library's rows, as its title's long press offers. */
export default function LibraryLayoutSettingsScreen() {
  useScreenContent(true);
  return (
    <SettingsPageScreen layoutPage="library">
      <ChoiceSection
        choice={libraryShelfChoice}
        current={useLibraryShelf()}
        note="One of Home's sections, shown under the Library's rows while it has something to show."
      />
    </SettingsPageScreen>
  );
}
