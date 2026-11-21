import type { ArtistPageAbout } from "@wave/core";
import { useState } from "react";
import { Text, View } from "react-native";

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
  // Another description (a lookup replacing the kept one) starts folded, its lines uncounted.
  return <AboutCard key={about.description} about={about} />;
}

function AboutCard({ about }: { about: ArtistPageAbout }) {
  const { strings } = useLocalisation();
  const [expanded, setExpanded] = useState(false);
  // How many lines the whole text takes, counted by an unseen copy laid out at
  // the same width, which counts again when the width or the font scale changes.
  const [lines, setLines] = useState<number | null>(null);
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
        <View>
          <Text
            numberOfLines={expanded ? undefined : FOLDED_LINES}
            className="font-sans text-body text-foreground"
          >
            {about.description}
          </Text>
          <View
            pointerEvents="none"
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            style={{ position: "absolute", top: 0, left: 0, right: 0, opacity: 0 }}
          >
            <Text
              onTextLayout={(event) => setLines(event.nativeEvent.lines.length)}
              className="font-sans text-body"
            >
              {about.description}
            </Text>
          </View>
        </View>
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
