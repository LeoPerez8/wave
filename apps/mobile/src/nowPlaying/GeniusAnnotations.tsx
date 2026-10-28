import {
  geniusLineSegments,
  withOpacity,
  type GeniusHighlight,
  type GeniusReferent,
} from "@wave/core";
import * as Haptics from "expo-haptics";
import { Text, View } from "react-native";

import { CELL } from "@/catalog/grid";
import { TextButton } from "@/components/TextButton";
import { CardEntries } from "@/overlay/CardEntries";
import { openOverlay } from "@/overlay/overlay";
import { useThemeColor } from "@/theme/useThemeColor";

/** A line without highlights, shared so memoised lines keep their props. */
export const NO_HIGHLIGHTS: readonly GeniusHighlight[] = [];

/** How many lines of an annotation "More insights" shows before a tap opens all of it. */
const FOLDED_LINES = 3;

/** "By Ana", "By Ana and Bo", "By Ana, Bo and Cy"; empty with no one named. */
const byLine = (authors: readonly string[]): string =>
  authors.length === 0
    ? ""
    : `By ${authors.length === 1 ? authors[0] : `${authors.slice(0, -1).join(", ")} and ${authors.at(-1)}`}`;

/** The fragment as Genius quotes it, its lines run together. */
const quoted = (fragment: string): string => `“${fragment.trim().replace(/\s*\n\s*/g, " / ")}”`;

/** The annotation card: the fragment, then each annotation with who wrote it. */
function AnnotationCard({ referent, close }: { referent: GeniusReferent; close: () => void }) {
  return (
    <>
      <CardEntries>
        <View style={{ gap: CELL, paddingTop: CELL, paddingBottom: CELL * 2 }}>
          <Text
            accessibilityRole="header"
            className="font-sans text-footnote font-semibold text-secondary"
          >
            Genius
          </Text>
          <Text className="font-sans text-subheadline font-medium text-foreground">
            {quoted(referent.fragment)}
          </Text>
          {referent.annotations.map((annotation, at) => (
            <View key={at} style={{ gap: CELL / 2, paddingTop: CELL }}>
              <Text className="font-sans text-body text-foreground">{annotation.text}</Text>
              {annotation.authors.length > 0 && (
                <Text className="font-sans text-footnote text-secondary">
                  {byLine(annotation.authors)}
                </Text>
              )}
            </View>
          ))}
        </View>
      </CardEntries>
      <View className="flex-row items-center justify-end">
        <TextButton label="Done" onPress={close} />
      </View>
    </>
  );
}

/** Opens [referent]'s annotation on a card over the lyrics (docs/spec.md, "Genius annotations"). */
export const openGeniusAnnotation = (referent: GeniusReferent): void => {
  openOverlay({
    label: `Genius annotation on ${quoted(referent.fragment)}`,
    render: (close) => <AnnotationCard referent={referent} close={close} />,
  });
};

const pressAnnotation = (referent: GeniusReferent): void => {
  void Haptics.selectionAsync();
  openGeniusAnnotation(referent);
};

/** The soft backdrop under an annotated fragment, as genius.com's: the ink, faint. */
export const useHighlightFill = (): string => withOpacity(useThemeColor("foreground"), 0.1);

/**
 * A lyric line's text with its annotated fragments on a soft backdrop; a tap
 * on one opens its annotation, a tap elsewhere goes to the line's own press.
 * [lit] says which of its words are in ink (Karaoke's sung words; none
 * given leaves the colour to the line). Put it inside the line's Text.
 */
export function HighlightedLine({
  text,
  highlights,
  wordStarts,
  lit,
}: {
  text: string;
  highlights: readonly GeniusHighlight[];
  wordStarts?: readonly number[];
  lit?: (word: number) => boolean;
}) {
  const fill = useHighlightFill();
  if (highlights.length === 0 && wordStarts === undefined) return text;
  return geniusLineSegments(text, highlights, wordStarts).map((segment) => {
    const { referent } = segment;
    return (
      <Text
        key={segment.start}
        className={lit?.(segment.word) ? "text-foreground" : undefined}
        style={referent === null ? undefined : { backgroundColor: fill }}
        onPress={referent === null ? undefined : () => pressAnnotation(referent)}
        accessibilityRole={referent === null ? undefined : "link"}
        accessibilityHint={referent === null ? undefined : "Shows Genius's annotation"}
      >
        {text.slice(segment.start, segment.end)}
      </Text>
    );
  });
}

/**
 * Screen readers' way to a line's annotations, which a press on the line
 * hides: one action for each referent highlighted on it.
 */
export const annotationActions = (
  highlights: readonly GeniusHighlight[],
): {
  readonly accessibilityActions?: { name: string; label: string }[];
  readonly onAccessibilityAction?: (event: { nativeEvent: { actionName: string } }) => void;
} => {
  const referents = [...new Set(highlights.map((highlight) => highlight.referent))];
  if (referents.length === 0) return {};
  return {
    accessibilityActions: referents.map((referent) => ({
      name: `genius-${referent.id}`,
      label: `Genius annotation on ${quoted(referent.fragment)}`,
    })),
    onAccessibilityAction: (event) => {
      const referent = referents.find(
        (each) => `genius-${each.id}` === event.nativeEvent.actionName,
      );
      if (referent !== undefined) openGeniusAnnotation(referent);
    },
  };
};

/**
 * After the last line: the annotations whose fragment isn't in these lyrics,
 * each with its fragment and the start of its annotation; a tap opens it.
 */
export function MoreInsights({ referents }: { referents: readonly GeniusReferent[] }) {
  if (referents.length === 0) return null;
  return (
    <View style={{ paddingTop: CELL * 4, gap: CELL * 2 }}>
      <Text
        accessibilityRole="header"
        className="font-sans text-title3 font-medium text-foreground"
      >
        More insights
      </Text>
      {referents.map((referent) => (
        <TextButton
          key={referent.id}
          label={`${quoted(referent.fragment)}. ${referent.annotations[0]!.text}`}
          tone="primary"
          accessibilityHint="Shows Genius's annotation"
          onPress={() => openGeniusAnnotation(referent)}
          className="rounded-2xl bg-surface"
          style={{ padding: CELL * 2 }}
        >
          <View style={{ gap: CELL / 2 }}>
            <Text className="font-sans text-subheadline font-medium text-foreground">
              {quoted(referent.fragment)}
            </Text>
            <Text
              numberOfLines={FOLDED_LINES}
              className="font-sans text-subheadline text-secondary"
            >
              {referent.annotations[0]!.text}
            </Text>
          </View>
        </TextButton>
      ))}
    </View>
  );
}
