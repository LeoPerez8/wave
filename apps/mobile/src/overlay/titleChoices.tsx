import { entryDivider } from "@wave/core";
import { View } from "react-native";

import { CatalogLine } from "@/catalog/CatalogLine";
import { EntryRow } from "@/catalog/EntryRow";
import { CELL } from "@/catalog/grid";
import { pressedRect } from "@/motion/pressedRect";

import { CardEntries } from "./CardEntries";
import { useOverlayFlow } from "./flow";
import { openOverlay } from "./overlay";
import { useSlideToChoose } from "./useSlideToChoose";

/** One entry of a title's choice card. */
export interface TitleChoice<T> {
  readonly value: T;
  readonly label: string;
}

/** A group of a title's choice card: one setting's choices, [current] checked. */
interface TitleChoiceGroup<T> {
  /** Names the group, over its entries ("Sort by"); the card's first group goes without. */
  readonly heading?: string | undefined;
  readonly choices: readonly TitleChoice<T>[];
  readonly current: T;
  readonly choose: (value: T) => void;
}

/** A card entry, its setting's type erased so groups of different settings sit together. */
interface CardChoice {
  readonly label: string;
  readonly selected: boolean;
  readonly choose: () => void;
}

/** A group as the card draws it (`titleChoiceGroup` makes one). */
export interface CardGroup {
  readonly heading: string | undefined;
  readonly entries: readonly CardChoice[];
}

/** [group] as a group of a title's choice card, for `openTitleChoiceGroups`. */
export const titleChoiceGroup = <T,>({
  heading,
  choices,
  current,
  choose,
}: TitleChoiceGroup<T>): CardGroup => ({
  heading,
  entries: choices.map((choice) => ({
    label: choice.label,
    selected: Object.is(choice.value, current),
    choose: () => choose(choice.value),
  })),
});

/**
 * The choice card: each group's entries in order, its current one checked,
 * under its heading. Slide to choose runs across every group.
 */
function ChoiceCard({ groups, close }: { groups: readonly CardGroup[]; close: () => void }) {
  const all = groups.flatMap((group) => group.entries);
  const pick = (index: number) => {
    const entry = all[index];
    if (entry === undefined) return;
    close();
    entry.choose();
  };
  const { underFinger, trackEntry, trackList } = useSlideToChoose(pick);
  const flow = useOverlayFlow();
  // Where each group's entries start among all of them.
  const starts = groups.map((_, index) =>
    groups.slice(0, index).reduce((sum, group) => sum + group.entries.length, 0),
  );
  // No heading for the first group: the highlighted title says what the card is about, as a row does for its menu.
  // Flat children, so a card running up mirrors every group as it mirrors a single one.
  return (
    <CardEntries listRef={trackList}>
      {groups.flatMap((group, groupIndex) => {
        const start = starts[groupIndex] ?? 0;
        const heading =
          group.heading === undefined
            ? []
            : [
                <View
                  key={`heading:${group.heading}`}
                  accessibilityRole="header"
                  style={{ paddingTop: CELL * 3, paddingBottom: CELL / 2 }}
                >
                  <CatalogLine>{group.heading}</CatalogLine>
                </View>,
              ];
        const entries = group.entries.map((entry, index) => (
          <View key={entry.label} ref={trackEntry(start + index)} collapsable={false}>
            <EntryRow
              label={entry.label}
              selected={entry.selected}
              divider={entryDivider(index, group.entries.length, flow)}
              highlighted={start + index === underFinger}
              onPress={() => pick(start + index)}
            />
          </View>
        ));
        return [...heading, ...entries];
      })}
    </CardEntries>
  );
}

/**
 * Opens a card of [groups] next to the title whose long press calls it (call
 * it from a `TitleLongPress`'s `open`), each group's current choice checked
 * (`titleChoiceGroup` makes a group). The finger that long-pressed can slide
 * onto a choice and lift, or the card stays open to tap. Choosing one closes
 * the card and hands it to its group's `choose`. [label] names the card for
 * screen readers.
 */
export const openTitleChoiceGroups = ({
  label,
  groups,
}: {
  label: string;
  groups: readonly CardGroup[];
}): void => {
  openOverlay({
    label,
    anchor: pressedRect(),
    render: (close) => <ChoiceCard groups={groups} close={close} />,
  });
};

/**
 * Opens a card of [choices] next to the title whose long press calls it (call
 * it from a `TitleLongPress`'s `open`), [current] checked. The finger that
 * long-pressed can slide onto a choice and lift, or the card stays open to
 * tap. Choosing one closes the card and hands it to [choose]. [label] names
 * the card for screen readers.
 */
export const openTitleChoices = <T,>({
  label,
  choices,
  current,
  choose,
}: {
  label: string;
  choices: readonly TitleChoice<T>[];
  current: T;
  choose: (value: T) => void;
}): void =>
  openTitleChoiceGroups({ label, groups: [titleChoiceGroup({ choices, current, choose })] });
