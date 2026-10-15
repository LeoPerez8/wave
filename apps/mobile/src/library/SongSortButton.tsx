import { IconArrowsSort } from "@tabler/icons-react-native";
import {
  entryDivider,
  sameSongSort,
  songSortLabel,
  songSortsFor,
  type SongListKind,
  type SongSort,
} from "@wave/core";
import { Text } from "react-native";

import { EntryRow } from "@/catalog/EntryRow";
import { CELL } from "@/catalog/grid";
import { Hairline } from "@/catalog/Hairline";
import { IconButton } from "@/components/IconButton";
import { pressedRect } from "@/motion/pressedRect";
import { CardEntries } from "@/overlay/CardEntries";
import { useOverlayFlow } from "@/overlay/flow";
import { openOverlay } from "@/overlay/overlay";

import { setSongSort, useSongSort } from "./songSort";

/** The sort card: the [sorts] on offer, [current] checked. */
function SortMenu({
  sorts,
  current,
  choose,
}: {
  sorts: readonly SongSort[];
  current: SongSort;
  choose: (sort: SongSort) => void;
}) {
  const flow = useOverlayFlow();
  return (
    <>
      <Text
        accessibilityRole="header"
        className="font-sans text-body font-medium text-foreground"
        style={{ paddingBottom: CELL * 1.5 }}
      >
        Sort by
      </Text>
      <Hairline />
      <CardEntries>
        {sorts.map((sort, index) => (
          <EntryRow
            key={songSortLabel(sort)}
            label={songSortLabel(sort)}
            selected={sameSongSort(sort, current)}
            divider={entryDivider(index, sorts.length, flow)}
            onPress={() => choose(sort)}
          />
        ))}
      </CardEntries>
    </>
  );
}

/**
 * Opens the sort card next to the button whose press calls it: the [sorts] on
 * offer, [current] checked. Choosing one closes the card and hands it to
 * [choose]. The Design preview opens it too, with a [choose] that does nothing.
 */
export const openSortMenu = (
  sorts: readonly SongSort[],
  current: SongSort,
  choose: (sort: SongSort) => void,
): void => {
  openOverlay({
    label: "Sort by",
    anchor: pressedRect(),
    render: (close) => (
      <SortMenu
        sorts={sorts}
        current={current}
        choose={(sort) => {
          choose(sort);
          close();
        }}
      />
    ),
  });
};

/** The sort glyph, its label telling screen readers [sort]; its press opens a card. */
export function SortButton({ sort, onPress }: { sort: SongSort; onPress: () => void }) {
  return (
    <IconButton
      icon={IconArrowsSort}
      label={`Sort, ${songSortLabel(sort)}`}
      opensMenu
      onPress={onPress}
    />
  );
}

/**
 * The sort control of a song list's header (`ListIntro`'s `sortControl`):
 * opens a menu of the [kind] list's sorts next to itself. Its label tells
 * screen readers the current sort.
 */
export function SongSortButton({ kind }: { kind: SongListKind }) {
  const sort = useSongSort(kind);
  return (
    <SortButton
      sort={sort}
      onPress={() => openSortMenu(songSortsFor(kind), sort, (chosen) => setSongSort(kind, chosen))}
    />
  );
}
