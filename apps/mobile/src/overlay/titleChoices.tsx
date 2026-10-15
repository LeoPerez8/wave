import { entryDivider } from "@wave/core";
import { View } from "react-native";

import { EntryRow } from "@/catalog/EntryRow";
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

/** The choice card: [choices] in order, [current] checked, slide to choose included. */
function ChoiceCard<T>({
  choices,
  current,
  choose,
}: {
  choices: readonly TitleChoice<T>[];
  current: T;
  choose: (value: T) => void;
}) {
  const pick = (index: number) => {
    const choice = choices[index];
    if (choice !== undefined) choose(choice.value);
  };
  const { underFinger, trackEntry, trackList } = useSlideToChoose(pick);
  const flow = useOverlayFlow();
  // No heading: the highlighted title says what the card is about, as a row does for its menu.
  return (
    <CardEntries listRef={trackList}>
      {choices.map((choice, index) => (
        <View key={choice.label} ref={trackEntry(index)} collapsable={false}>
          <EntryRow
            label={choice.label}
            selected={Object.is(choice.value, current)}
            divider={entryDivider(index, choices.length, flow)}
            highlighted={index === underFinger}
            onPress={() => pick(index)}
          />
        </View>
      ))}
    </CardEntries>
  );
}

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
}): void => {
  openOverlay({
    label,
    anchor: pressedRect(),
    render: (close) => (
      <ChoiceCard
        choices={choices}
        current={current}
        choose={(value) => {
          close();
          choose(value);
        }}
      />
    ),
  });
};
