import type { ArtistPageAbout } from "@wave/core";
import { useState } from "react";
import { Text, View, type TextLayoutEvent } from "react-native";

import { SectionHead } from "@/catalog/CatalogLine";
import { CELL } from "@/catalog/grid";
import { TextButton } from "@/components/TextButton";
import { useLocalisation } from "@/localisation/localisation";

/** How many lines of the description show until Show more is tapped. */
const FOLDED_LINES = 4;

/**
 * An artist page's About (docs/spec.md, "YT Music artist page"): its heading
 * over a card with the artist's description, folded to its first lines until
 * Show more is tapped (Show less folds it again; a text that fits has no
 * button), and under it the subscriber and view counts the page came with,
 * each left out when there's none. Which artists get one is Core's
 * (`artistPageItems`, `ytArtistAbout`).
 */
export function ArtistAbout({ about }: { about: ArtistPageAbout }) {
  const { strings } = useLocalisation();
  const [expanded, setExpanded] = useState(false);
  // The whole text is laid out once to count its lines, then folded.
  const [lines, setLines] = useState<number | null>(null);
  const onTextLayout = (event: TextLayoutEvent) => {
    const count = event.nativeEvent.lines.length;
    setLines((known) => (known === null || expanded ? count : known));
  };
  const folds = lines !== null && lines > FOLDED_LINES;
  const counts = [
    about.subscribers === null ? null : strings.library.subscribersValue(about.subscribers),
    about.views === null ? null : strings.library.viewsValue(about.views),
  ].filter((count) => count !== null);
  return (
    <View>
      <SectionHead label={strings.library.about} />
      <View
        className="rounded-2xl bg-surface"
        style={{ padding: CELL * 2, marginBottom: CELL * 2 }}
      >
        <Text
          onTextLayout={onTextLayout}
          numberOfLines={expanded || lines === null ? undefined : FOLDED_LINES}
          className="font-sans text-body text-foreground"
        >
          {about.description}
        </Text>
        {folds && (
          <TextButton
            label={expanded ? strings.library.showLess : strings.library.showMore}
            accessibilityState={{ expanded }}
            onPress={() => setExpanded((was) => !was)}
            labelProps={{ className: "font-sans text-footnote font-medium" }}
            style={{ alignSelf: "flex-start" }}
          />
        )}
        {counts.map((count) => (
          <Text
            key={count}
            className="font-sans text-footnote text-secondary"
            style={{ marginTop: folds ? 0 : CELL }}
          >
            {count}
          </Text>
        ))}
      </View>
    </View>
  );
}
