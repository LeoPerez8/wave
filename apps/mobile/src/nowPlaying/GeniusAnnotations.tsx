import { currentLocalisation, useLocalisation } from "@/localisation/localisation";
import {
  geniusLineSegments,
  geniusSection,
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
  currentLocalisation().strings.playbackText.byAuthors(authors);

/**
 * What an annotation explains: its fragment as Genius quotes it, its lines
 * run together, or a section's name ("Verse 1") for a section heading.
 */
const explained = (fragment: string): string =>
  geniusSection(fragment) ?? `“${fragment.trim().replace(/\s*\n\s*/g, " / ")}”`;

/**
 * The annotation card: each referent's fragment (or section), then its
 * annotations with who wrote them, an unreviewed one marked as genius.com
 * marks it.
 */
function AnnotationCard({
  referents,
  close,
}: {
  referents: readonly GeniusReferent[];
  close: () => void;
}) {
  const { strings } = useLocalisation();
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
          {referents.map((referent) => (
            <View key={referent.id} style={{ gap: CELL }}>
              <Text className="font-sans text-subheadline font-medium text-foreground">
                {explained(referent.fragment)}
              </Text>
              {referent.annotations.map((annotation, at) => (
                <View key={at} style={{ gap: CELL / 2, paddingTop: CELL }}>
                  {annotation.state === "pending" && (
                    <Text className="font-sans text-footnote font-semibold text-secondary">
                      {strings.playbackText.unreviewed}
                    </Text>
                  )}
                  <Text className="font-sans text-body text-foreground">{annotation.text}</Text>
                  {annotation.authors.length > 0 && (
                    <Text className="font-sans text-footnote text-secondary">
                      {byLine(annotation.authors)}
                    </Text>
                  )}
                </View>
              ))}
            </View>
          ))}
        </View>
      </CardEntries>
      <View className="flex-row items-center justify-end">
        <TextButton label={strings.playbackText.done} onPress={close} />
      </View>
    </>
  );
}

/** How screen readers name the annotations on [referents]. */
const annotationLabel = (referents: readonly GeniusReferent[]): string =>
  currentLocalisation().strings.playbackText.annotationOn(explained(referents[0]!.fragment));

/**
 * Opens [referents]' annotations (a highlight's, or one of More insights) on
 * a card over the lyrics (docs/spec.md, "Genius annotations").
 */
const openAnnotations = (referents: readonly GeniusReferent[]): void => {
  openOverlay({
    label: annotationLabel(referents),
    render: (close) => <AnnotationCard referents={referents} close={close} />,
  });
};

const pressAnnotations = (referents: readonly GeniusReferent[]): void => {
  void Haptics.selectionAsync();
  openAnnotations(referents);
};

/** The soft backdrop under an annotated fragment, as genius.com's: the ink, faint. */
const useHighlightFill = (): string => withOpacity(useThemeColor("foreground"), 0.1);

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
  const { strings } = useLocalisation();
  const fill = useHighlightFill();
  if (highlights.length === 0 && wordStarts === undefined) return text;
  return geniusLineSegments(text, highlights, wordStarts).map((segment) => {
    const { referents } = segment;
    const annotated = referents.length > 0;
    return (
      // A highlight is a span of the line's text that wraps with it, which only a nested Text
      // can be; reviewed in OWN_PRESS (perf/performancePolicy.ts).
      <Text
        key={segment.start}
        className={lit?.(segment.word) ? "text-foreground" : undefined}
        style={annotated ? { backgroundColor: fill } : undefined}
        onPress={annotated ? () => pressAnnotations(referents) : undefined}
        accessibilityRole={annotated ? "link" : undefined}
        accessibilityHint={annotated ? strings.playbackText.showsGeniussAnnotations : undefined}
      >
        {text.slice(segment.start, segment.end)}
      </Text>
    );
  });
}

/** A highlight's accessibility action, named after the referent placed there first. */
const actionName = (referents: readonly GeniusReferent[]): string => `genius-${referents[0]!.id}`;

/**
 * Screen readers' way to a line's annotations, which a press on the line
 * hides: one action for each highlight on it, opening all its annotations.
 */
export const annotationActions = (
  highlights: readonly GeniusHighlight[],
): {
  readonly accessibilityActions?: { name: string; label: string }[];
  readonly onAccessibilityAction?: (event: { nativeEvent: { actionName: string } }) => void;
} => {
  // One action a place: the parts of a highlight running over lines share their referents,
  // and a fragment repeated on the line opens the same annotations.
  const places = [
    ...new Map(
      highlights.map((highlight) => [actionName(highlight.referents), highlight.referents]),
    ).values(),
  ];
  if (places.length === 0) return {};
  return {
    accessibilityActions: places.map((referents) => ({
      name: actionName(referents),
      label: annotationLabel(referents),
    })),
    onAccessibilityAction: (event) => {
      const referents = places.find((each) => actionName(each) === event.nativeEvent.actionName);
      if (referents !== undefined) openAnnotations(referents);
    },
  };
};

/**
 * After the last line: the annotations whose fragment isn't in these lyrics
 * or that explain a whole section, each with its fragment (or the section's
 * name) and the start of its annotation; a tap opens it.
 */
export function MoreInsights({ referents }: { referents: readonly GeniusReferent[] }) {
  const { strings } = useLocalisation();
  if (referents.length === 0) return null;
  return (
    <View style={{ paddingTop: CELL * 4, gap: CELL * 2 }}>
      <Text
        accessibilityRole="header"
        className="font-sans text-title3 font-medium text-foreground"
      >
        {strings.playbackText.moreInsights}
      </Text>
      {referents.map((referent) => (
        <TextButton
          key={referent.id}
          label={`${explained(referent.fragment)}. ${referent.annotations[0]!.text}`}
          tone="primary"
          accessibilityHint={strings.playbackText.showsGeniussAnnotation}
          onPress={() => openAnnotations([referent])}
          className="rounded-2xl bg-surface"
          style={{ padding: CELL * 2 }}
        >
          <View style={{ gap: CELL / 2 }}>
            <Text className="font-sans text-subheadline font-medium text-foreground">
              {explained(referent.fragment)}
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
