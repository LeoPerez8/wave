import { importProgressLine } from "@wave/core";
import { Text } from "react-native";

import { useLocalisation } from "@/localisation/localisation";
import { useFavoritesExportProgress } from "./importProgress";

/** Keeps Favorites' export visible after its picker closes. */
export function FavoritesExportLine() {
  const progress = useFavoritesExportProgress();
  const { strings, language } = useLocalisation();
  if (progress === null) return null;
  return (
    <Text accessibilityLiveRegion="polite" className="font-sans text-subheadline text-secondary">
      {strings.home.sections.favorites}
      {": "}
      {importProgressLine(progress, language)}
    </Text>
  );
}
