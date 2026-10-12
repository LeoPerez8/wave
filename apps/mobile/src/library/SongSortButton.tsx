import { IconArrowsSort } from "@tabler/icons-react-native";
import {
  entryDivider,
  sameSongSort,
  songSortLabel,
  songSortsFor,
  type SongListKind,
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

/** The sorts on offer, the current one checked; choosing one closes the card. */
function SortMenu({ kind, close }: { kind: SongListKind; close: () => void }) {
  const current = useSongSort(kind);
  const sorts = songSortsFor(kind);
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
            onPress={() => {
              setSongSort(kind, sort);
              close();
            }}
          />
        ))}
      </CardEntries>
    </>
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
      <IconButton
        icon={IconArrowsSort}
        label={`Sort, ${songSortLabel(sort)}`}
        opensMenu
        onPress={() =>
          openOverlay({
            label: "Sort by",
            anchor: pressedRect(),
            render: (close) => <SortMenu kind={kind} close={close} />,
          })
        }
      />
    </View>
  );
}
