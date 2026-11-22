import { View } from "react-native";

import { CELL } from "@/catalog/grid";
import { TextButton } from "@/components/TextButton";
import { useLocalisation } from "@/localisation/localisation";

/** Height of See more's row: one touch target. */
export const SEE_MORE_ROW = CELL * 6;

/**
 * See more, under an artist page's first songs (Core's `artistPageItems`):
 * opens the artist's Songs screen with all of them.
 */
export function SeeMoreRow({ onPress }: { onPress: () => void }) {
  const { strings } = useLocalisation();
  return (
    <View className="justify-center" style={{ height: SEE_MORE_ROW }}>
      <TextButton
        label={strings.library.seeMore}
        onPress={onPress}
        labelProps={{ className: "font-sans text-footnote font-medium" }}
        style={{ alignSelf: "flex-start" }}
      />
    </View>
  );
}
