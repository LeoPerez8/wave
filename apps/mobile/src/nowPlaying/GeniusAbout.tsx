import { useLocalisation } from "@/localisation/localisation";
import { useState } from "react";
import { Text, View } from "react-native";

import { CELL } from "@/catalog/grid";
import { TextButton } from "@/components/TextButton";

import type { GeniusAboutText } from "./useGenius";

/** How many lines of the description show until the card is tapped. */
const FOLDED_LINES = 3;

/**
 * The About card at the top of the lyrics (docs/spec.md, "Genius About"):
 * the first lines of Genius's description of the song, and all of it after
 * a tap (another tap folds it again). Nothing without a description. Keyed
 * by its original, a translation arriving replaces the text and keeps the
 * card as it is.
 */
export function GeniusAbout({ about }: { about: GeniusAboutText | null }) {
  const { strings } = useLocalisation();
  const [expanded, setExpanded] = useState(false);
  if (about === null) return null;
  const description = about.shown;
  return (
    <TextButton
      label={strings.playbackText.aboutThisSongFromGeniusValue(description)}
      tone="primary"
      accessibilityState={{ expanded }}
      accessibilityHint={
        expanded ? strings.playbackText.showsLessOfIt : strings.playbackText.showsAllOfIt
      }
      onPress={() => setExpanded((was) => !was)}
      className="rounded-2xl bg-surface"
      style={{ padding: CELL * 2, marginBottom: CELL * 2 }}
    >
      <View>
        <Text className="font-sans text-footnote font-semibold text-secondary">
          {strings.playbackText.aboutGenius}
        </Text>
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
          {expanded ? strings.playbackText.showLess : strings.playbackText.more}
        </Text>
      </View>
    </TextButton>
  );
}
