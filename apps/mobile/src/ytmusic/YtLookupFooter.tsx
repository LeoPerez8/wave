import { Text, View } from "react-native";

import { CELL } from "@/catalog/grid";
import { TextButton } from "@/components/TextButton";

/**
 * The end of a Library page that also shows what YouTube Music has (an
 * artist's, an album's): a quiet line (looking, not found, offline…) and
 * Show on YouTube Music when it can be asked.
 */
export function YtLookupFooter({
  note,
  button,
  onShow,
}: {
  note: string | null;
  button: boolean;
  onShow: () => void;
}) {
  if (note === null && !button) return null;
  return (
    <View style={{ paddingTop: CELL * 2 }}>
      {note !== null && (
        <View className="justify-center" style={{ minHeight: CELL * 6 }}>
          <Text className="font-sans text-footnote text-secondary">{note}</Text>
        </View>
      )}
      {button && <TextButton label="Show on YouTube Music" onPress={onShow} />}
    </View>
  );
}
