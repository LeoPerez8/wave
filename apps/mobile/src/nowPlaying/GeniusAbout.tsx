import { useState } from "react";
import { Text, View } from "react-native";

import { CELL } from "@/catalog/grid";
import { TextButton } from "@/components/TextButton";

/** How many lines of the description show until the card is tapped. */
const FOLDED_LINES = 3;

/**
 * The About card at the top of the lyrics (docs/spec.md, "Genius About"):
 * the first lines of Genius's description of the song, and all of it after
 * a tap (another tap folds it again). Nothing without a description.
 */
export function GeniusAbout({ description }: { description: string | null }) {
  const [expanded, setExpanded] = useState(false);
  if (description === null) return null;
  return (
    <TextButton
      label={`About this song, from Genius. ${description}`}
      tone="primary"
      accessibilityState={{ expanded }}
      accessibilityHint={expanded ? "Shows less of it" : "Shows all of it"}
      onPress={() => setExpanded((was) => !was)}
      className="rounded-2xl bg-surface"
      style={{ padding: CELL * 2, marginBottom: CELL * 2 }}
    >
      <View>
        <Text className="font-sans text-footnote font-semibold text-secondary">About · Genius</Text>
        <Text
          numberOfLines={expanded ? undefined : FOLDED_LINES}
          className="font-sans text-body text-foreground"
          style={{ marginTop: CELL / 2 }}
        >
          {description}
        </Text>
        <Text
          className="font-sans text-footnote font-medium text-accent"
          style={{ marginTop: CELL }}
        >
          {expanded ? "Show Less" : "More"}
        </Text>
      </View>
    </TextButton>
  );
}
