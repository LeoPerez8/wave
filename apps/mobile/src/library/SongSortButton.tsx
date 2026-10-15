import { IconArrowsSort } from "@tabler/icons-react-native";
import {
  entryDivider,
  sameSongSort,
  songSortLabel,
  songSortsFor,
  type SongListKind,
  type SongSort,
} from "@wave/core";
import { Text, View } from "react-native";

import { EntryRow } from "@/catalog/EntryRow";
import { CELL } from "@/catalog/grid";
import { Hairline } from "@/catalog/Hairline";
import { IconButton } from "@/components/IconButton";
import { pressedRect } from "@/motion/pressedRect";
import { CardEntries } from "@/overlay/CardEntries";
import { useOverlayFlow } from "@/overlay/flow";
import { openOverlay } from "@/overlay/overlay";

import { setSongSort, useSongSort } from "./songSort";

/**
 * The sort card: the [sorts] on offer, [current] checked. The Design preview
 * draws it too, with a [choose] that only closes it.
 */
export function SortMenu({
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

/** A [kind] list's sorts, the current one checked; choosing one sorts by it and closes the card. */
function KindSortMenu({ kind, close }: { kind: SongListKind; close: () => void }) {
  const current = useSongSort(kind);
  return (
    <SortMenu
      sorts={songSortsFor(kind)}
      current={current}
      choose={(sort) => {
        setSongSort(kind, sort);
        close();
      }}
    />
  );
}

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
 * The sort control of a song list's header: opens a menu of sorts next to
 * itself. Its label tells screen readers the current sort.
 */
export function SongSortButton({ kind }: { kind: SongListKind }) {
  const sort = useSongSort(kind);
  return (
    // Its glyph sits on the right margin, like Back on the left.
    <View className="-mr-3">
      <SortButton
        sort={sort}
        onPress={() =>
          openOverlay({
            label: "Sort by",
            anchor: pressedRect(),
            render: (close) => <KindSortMenu kind={kind} close={close} />,
          })
        }
      />
    </View>
  );
}
