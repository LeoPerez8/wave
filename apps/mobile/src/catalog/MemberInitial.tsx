import { Text, View } from "react-native";

import { CELL } from "./grid";

/** A row's initial: 22dp. */
const SMALL = CELL * 2.75;

/**
 * A collaborative playlist member's initial in a small circle (docs/spec.md, "Collaborative
 * playlists", What it shows): at a row's end, who added the song; under a playlist's name,
 * one of its members, [stacked] over the one before. Drawn for sight only: the row's menu
 * and the members' line say the names.
 */
export function MemberInitial({
  initial,
  stacked = false,
}: {
  initial: string;
  stacked?: boolean;
}) {
  return (
    <View
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      className={`items-center justify-center border bg-surface ${stacked ? "border-background" : "border-separator"}`}
      style={{
        width: SMALL,
        height: SMALL,
        borderRadius: SMALL / 2,
        marginLeft: stacked ? -CELL * 0.75 : 0,
      }}
    >
      <Text
        numberOfLines={1}
        allowFontScaling={false}
        className="font-sans text-caption font-semibold text-secondary"
      >
        {initial}
      </Text>
    </View>
  );
}
