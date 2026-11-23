import { Image } from "expo-image";
import { useState } from "react";
import { Text, View } from "react-native";

import { CELL } from "./grid";

/** A member's circle: 22dp, a row's end cell and the size under a playlist's name. */
const SMALL = CELL * 2.75;

/**
 * A collaborative playlist member in a small circle (docs/spec.md, "Collaborative playlists",
 * What it shows): their Google photo ([photoUrl]), else their [initial], also once the photo
 * fails to load. At a row's end, who added the song; under a playlist's name, one of its
 * members, [stacked] over the one before. Drawn for sight only: the row's menu and the
 * members' line say the names.
 */
export function MemberCircle({
  initial,
  photoUrl = null,
  stacked = false,
}: {
  initial: string;
  photoUrl?: string | null;
  stacked?: boolean;
}) {
  // The address that failed to load: it shows the initial until another address comes.
  const [failed, setFailed] = useState<string | null>(null);
  const photo = photoUrl !== null && photoUrl !== failed ? photoUrl : null;
  return (
    <View
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      className={`items-center justify-center overflow-hidden border bg-surface ${stacked ? "border-background" : "border-separator"}`}
      style={{
        width: SMALL,
        height: SMALL,
        borderRadius: SMALL / 2,
        marginLeft: stacked ? -CELL * 0.75 : 0,
      }}
    >
      {photo === null ? (
        <Text
          numberOfLines={1}
          allowFontScaling={false}
          className="font-sans text-caption font-semibold text-secondary"
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
