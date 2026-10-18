import { Text, View } from "react-native";

/** The badge's side: a little under the body text's cap height plus its descent. */
const SIZE = 14;

/**
 * The E badge an explicit song's row shows beside its title (Core's
 * `showsExplicitBadge`), as Apple Music shows it: a small rounded square in
 * the secondary colour, the letter cut out of it. The row says "explicit" to
 * screen readers, so the badge itself is hidden from them.
 */
export function ExplicitBadge() {
  return (
    <View
      className="items-center justify-center bg-secondary"
      style={{ width: SIZE, height: SIZE, borderRadius: 3 }}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Text
        className="font-sans font-semibold text-background"
        style={{ fontSize: 10, lineHeight: SIZE }}
        allowFontScaling={false}
      >
        E
      </Text>
    </View>
  );
}
