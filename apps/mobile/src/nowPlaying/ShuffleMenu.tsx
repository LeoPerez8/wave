import { entryDivider, type ShuffleKind } from "@wave/core";
import { View } from "react-native";

import { EntryRow } from "@/catalog/EntryRow";
import { pressedRect } from "@/motion/pressedRect";
import { CardEntries } from "@/overlay/CardEntries";
import { useOverlayFlow } from "@/overlay/flow";
import { openOverlay } from "@/overlay/overlay";
import { useSlideToChoose } from "@/overlay/useSlideToChoose";
import { chooseShuffleKind } from "@/playback/actions";
import { useShuffleKind } from "@/settings/shuffleKind";

const KINDS: readonly { readonly kind: ShuffleKind; readonly label: string }[] = [
  { kind: "real", label: "Real Shuffle" },
  { kind: "smart", label: "Smart Shuffle" },
];

/** What the shuffle button says while [kind] is chosen. */
export const shuffleLabel = (kind: ShuffleKind): string =>
  kind === "smart" ? "Smart Shuffle" : "Shuffle";

/**
 * The shuffle card: Real Shuffle and Smart Shuffle, the chosen one checked.
 * Picking one saves it and shuffles with it. Opened by a long press, the
 * finger can slide onto an entry and lift to pick it.
 */
function ShuffleMenu({ close }: { close: () => void }) {
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
      {KINDS.map(({ kind, label }, index) => (
        <View key={kind} ref={trackEntry(index)} collapsable={false}>
          <EntryRow
            label={label}
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
export const openShuffleMenu = (): void => {
  openOverlay({
    label: "Shuffle",
    anchor: pressedRect(),
    render: (close) => <ShuffleMenu close={close} />,
  });
};
