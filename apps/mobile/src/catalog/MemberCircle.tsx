import { Image } from "expo-image";
import { useState } from "react";
import { Text, View } from "react-native";

import { CELL } from "./grid";

/**
 * The circle's two sizes: "row", 22dp, a row's end cell and the size under a playlist's name;
 * "sheet", 36dp, a line of the Members sheet.
 */
const SIZES = {
  row: {
    side: CELL * 2.75,
    circle: "border bg-surface",
    letter: "text-caption",
  },
  sheet: {
    side: CELL * 4.5,
    circle: "bg-fill",
    letter: "text-body",
  },
} as const;

/**
 * A collaborative playlist member in a small circle (docs/spec.md, "Collaborative playlists",
 * What it shows): their Google photo ([photoUrl]), else their [initial], also once the photo
 * fails to load. At a row's end, who added the song; under a playlist's name, one of its
 * members, [stacked] over the one before; in the Members sheet ([size] "sheet"), each member.
 * Drawn for sight only: the row's menu, the members' line and the sheet say the names.
 */
export function MemberCircle({
  initial,
  photoUrl = null,
  stacked = false,
  size = "row",
}: {
  initial: string;
  photoUrl?: string | null | undefined;
  stacked?: boolean;
  size?: keyof typeof SIZES;
}) {
  // The address that failed to load: it shows the initial until another address comes or the
  // circle is drawn anew, and is not tried again before.
  const [failed, setFailed] = useState<string | null>(null);
  const photo = photoUrl !== null && photoUrl !== failed ? photoUrl : null;
  const { side, circle, letter } = SIZES[size];
  const border = size === "row" ? (stacked ? "border-background" : "border-separator") : "";
  return (
    <View
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      className={`items-center justify-center overflow-hidden ${circle} ${border}`}
      style={{
        width: side,
        height: side,
        borderRadius: side / 2,
        marginLeft: stacked ? -CELL * 0.75 : 0,
      }}
    >
      {photo === null ? (
        <Text
          numberOfLines={1}
          allowFontScaling={false}
          className={`font-sans font-semibold text-secondary ${letter}`}
        >
          {initial}
        </Text>
      ) : (
        <Image
          source={{ uri: photo }}
          recyclingKey={photo}
          style={{ width: "100%", height: "100%" }}
          contentFit="cover"
          accessibilityIgnoresInvertColors
          onError={() => setFailed(photo)}
        />
      )}
    </View>
  );
}
