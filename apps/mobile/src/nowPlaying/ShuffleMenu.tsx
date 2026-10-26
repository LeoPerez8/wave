import { IconArrowsShuffle } from "@tabler/icons-react-native";
import { entryDivider, shuffleLineShows, type ShuffleKind } from "@wave/core";
import { View } from "react-native";

import { EntryRow } from "@/catalog/EntryRow";
import { SmartShuffleIcon } from "@/components/SmartShuffleIcon";
import { pressedRect } from "@/motion/pressedRect";
import { CardEntries } from "@/overlay/CardEntries";
import { useOverlayFlow } from "@/overlay/flow";
import { openOverlay } from "@/overlay/overlay";
import { useSlideToChoose } from "@/overlay/useSlideToChoose";
import { chooseShuffleKind } from "@/playback/actions";
import { countShuffleCardOpening } from "@/settings/shuffleCardOpenings";
import { useShuffleKind } from "@/settings/shuffleKind";

/** The card's entries: each kind's name and the line saying what it does. */
const KINDS: readonly {
  readonly kind: ShuffleKind;
  readonly label: string;
  readonly line: string;
}[] = [
  { kind: "real", label: "Real Shuffle", line: "Any order, every one as likely" },
  { kind: "smart", label: "Smart Shuffle", line: "Your most played, spread among the rest" },
  { kind: "even", label: "Even Shuffle", line: "Artists take turns, never twice in a row" },
];

/** What the shuffle button says while [kind] is chosen. */
const SHUFFLE_LABELS: Record<ShuffleKind, string> = {
  real: "Shuffle",
  smart: "Smart Shuffle",
  even: "Even Shuffle",
};

/**
 * Every shuffle control follows the saved choice and opens the same card.
 * Even Shuffle keeps the plain shuffle icon until it has its own.
 */
export const useShuffleControl = () => {
  const kind = useShuffleKind();
  return {
    icon: kind === "smart" ? SmartShuffleIcon : IconArrowsShuffle,
    label: SHUFFLE_LABELS[kind],
    onLongPress: openShuffleMenu,
    accessibilityHint: "Long press to choose Real Shuffle, Smart Shuffle or Even Shuffle",
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
    const entry = KINDS[index];
    if (entry === undefined) return;
    close();
    void chooseShuffleKind(entry.kind);
  };
  const { underFinger, trackEntry, trackList } = useSlideToChoose(choose);
  return (
    <CardEntries listRef={trackList}>
      {KINDS.map(({ kind, label, line }, index) => (
        <View key={kind} ref={trackEntry(index)} collapsable={false}>
          <EntryRow
            label={label}
            line={line}
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
