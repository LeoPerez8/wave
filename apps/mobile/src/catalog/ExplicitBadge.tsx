import { Text, View, useWindowDimensions } from "react-native";

/** The badge's side at font scale 1: a little under the body text's cap height plus its descent. */
const SIZE = 14;
const LETTER = 10;
const CORNER = 3;

/**
 * The E badge an explicit song's row shows beside its title (Core's
 * `showsExplicitBadge`), as Apple Music shows it: a small rounded square in
 * the secondary colour, the letter cut out of it. It grows with the system
 * font size, as the title beside it does (the square and its letter scale
 * together, so the letter stays centred). The row says "explicit" to screen
 * readers, so the badge itself is hidden from them. DESIGN.md records its
 * rounded corners as a deliberate exception to Square everywhere.
 */
export function ExplicitBadge() {
  const { fontScale } = useWindowDimensions();
  const size = SIZE * fontScale;
  return (
    <View
      className="items-center justify-center bg-secondary"
      style={{ width: size, height: size, borderRadius: CORNER * fontScale }}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Text
        className="font-sans font-semibold text-background"
        style={{ fontSize: LETTER * fontScale, lineHeight: size }}
        allowFontScaling={false}
      >
        E
      </Text>
    </View>
  );
}
