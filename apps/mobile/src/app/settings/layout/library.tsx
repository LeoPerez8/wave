import { useLocalisation } from "@/localisation/localisation";
import { useScreenContent } from "@/lib/screenTiming";
import { libraryShelfChoice, useLibraryShelf } from "@/library/libraryShelf";
import { ChoiceSection } from "@/settings/ChoiceRow";
import { SettingsPageScreen } from "@/settings/SettingsPage";

/** Settings › Layout › Library: the shelf under the Library's rows, as its title's long press offers. */
export default function LibraryLayoutSettingsScreen() {
  const { strings } = useLocalisation();
  useScreenContent(true);
  return (
    <SettingsPageScreen layoutPage="library">
      <ChoiceSection
        choice={libraryShelfChoice}
        current={useLibraryShelf()}
        note={strings.settings.oneOfHomesSectionsShownUnderThe}
      />
    </SettingsPageScreen>
  );
}
