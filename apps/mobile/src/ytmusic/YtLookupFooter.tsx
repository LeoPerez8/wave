import { Text, View } from "react-native";

import { CELL } from "@/catalog/grid";

/**
 * The end of a Library page that also shows what YouTube Music has (an
 * artist's, an album's): a quiet line (looking, not found, offline…). The
 * page's Library | Online toggle, at its top, is what asks.
 */
export function YtLookupFooter({ note }: { note: string | null }) {
  if (note === null) return null;
  return (
    <View style={{ paddingTop: CELL * 2 }}>
      <View className="justify-center" style={{ minHeight: CELL * 6 }}>
        <Text className="font-sans text-footnote text-secondary">{note}</Text>
      </View>
    </View>
  );
}
