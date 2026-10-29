import { IconArrowsShuffle } from "@tabler/icons-react-native";
import { entryDivider, shuffleLineShows, type ShuffleKind } from "@wave/core";
import { View } from "react-native";

import { EntryRow } from "@/catalog/EntryRow";
import { EvenShuffleIcon } from "@/components/EvenShuffleIcon";
import { SmartShuffleIcon } from "@/components/SmartShuffleIcon";
import { pressedRect } from "@/motion/pressedRect";
import { CardEntries } from "@/overlay/CardEntries";
import { useOverlayFlow } from "@/overlay/flow";
import { openOverlay } from "@/overlay/overlay";
import { useSlideToChoose } from "@/overlay/useSlideToChoose";
import { chooseShuffleKind } from "@/playback/actions";
import type { ActionIcon } from "@/playback/actionIcons";
import type { ChoiceSetting } from "@/settings/ChoiceRow";
import { countShuffleCardOpening } from "@/settings/shuffleCardOpenings";
import { shuffleKindSetting, useShuffleKind } from "@/settings/shuffleKind";

/**
 * Each kind of shuffle: its name and the line saying what it does, on the
 * card; what the shuffle button says and shows while it's chosen (the plain
 * shuffle arrows, the spark, #320, or the braid, #702). The card lists them
 * in this order.
 */
const SHUFFLES: Record<
  ShuffleKind,
  {
    readonly name: string;
    readonly line: string;
    readonly buttonLabel: string;
    readonly icon: ActionIcon;
  }
> = {
  real: {
    name: "Real Shuffle",
    line: "Any order, every one as likely",
    buttonLabel: "Shuffle",
    icon: IconArrowsShuffle,
  },
  smart: {
    name: "Smart Shuffle",
    line: "Your most played, spread among the rest",
    buttonLabel: "Smart Shuffle",
    icon: SmartShuffleIcon,
  },
  even: {
    name: "Even Shuffle",
    line: "Artists take turns, never twice in a row",
    buttonLabel: "Even Shuffle",
    icon: EvenShuffleIcon,
  },
};

/** The card's entries, in order. */
const KINDS = Object.keys(SHUFFLES) as ShuffleKind[];

/** The kinds' names, in the card's order. */
const KIND_NAMES = KINDS.map((kind) => SHUFFLES[kind].name);

/**
 * The kind of shuffle as Settings › Layout › Now Playing offers it: the
 * card's kinds, under their card names. It's the card's own preference, so a
 * choice in either place shows in the other. Choosing here only saves it;
 * the next shuffle uses it.
 */
export const shuffleKindChoice: ChoiceSetting<ShuffleKind> = {
  label: "Shuffle",
  choices: KINDS.map((kind) => ({ value: kind, label: SHUFFLES[kind].name })),
  setting: shuffleKindSetting,
};

/** The shuffle buttons' hint: "Long press to choose Real Shuffle, Smart Shuffle or Even Shuffle". */
const LONG_PRESS_HINT = `Long press to choose ${KIND_NAMES.slice(0, -1).join(", ")} or ${KIND_NAMES.at(-1)}`;

/** Every shuffle control follows the saved choice and opens the same card. */
export const useShuffleControl = () => {
  const kind = useShuffleKind();
  return {
    icon: SHUFFLES[kind].icon,
    label: SHUFFLES[kind].buttonLabel,
    onLongPress: openShuffleMenu,
    accessibilityHint: LONG_PRESS_HINT,
  };
};

/**
 * The shuffle card: Real Shuffle, Smart Shuffle and Even Shuffle, the chosen
 * one checked. Picking one saves it and shuffles with it. Opened by a long press, the
 * finger can slide onto an entry and lift to pick it. Each entry's line says
 * what it does: on every entry for the card's first openings
 * ([openedBefore], Core's `shuffleLineShows`), then only on the entry under
 * the sliding finger.
 */
function ShuffleMenu({ close, openedBefore }: { close: () => void; openedBefore: number }) {
  const chosen = useShuffleKind();
  const flow = useOverlayFlow();
  const choose = (index: number) => {
    const kind = KINDS[index];
    if (kind === undefined) return;
    close();
    void chooseShuffleKind(kind);
  };
  const { underFinger, trackEntry, trackList } = useSlideToChoose(choose);
  return (
    <CardEntries listRef={trackList}>
      {KINDS.map((kind, index) => (
        <View key={kind} ref={trackEntry(index)} collapsable={false}>
          <EntryRow
            label={SHUFFLES[kind].name}
            line={SHUFFLES[kind].line}
            lineShown={shuffleLineShows({ openedBefore, underFinger, index })}
            selected={kind === chosen}
            divider={entryDivider(index, KINDS.length, flow)}
            highlighted={index === underFinger}
            onPress={() => choose(index)}
          />
        </View>
      ))}
    </CardEntries>
  );
}

/** Opens the shuffle card next to the shuffle button whose long press calls it. */
const openShuffleMenu = (): void => {
  const openedBefore = countShuffleCardOpening();
  openOverlay({
    label: "Shuffle",
    anchor: pressedRect(),
    render: (close) => <ShuffleMenu close={close} openedBefore={openedBefore} />,
  });
};
