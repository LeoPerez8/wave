import { IconArrowsSort } from "@tabler/icons-react-native";
import { songSortLabel, songSortsFor, type SongSort } from "@wave/core";
import { ScrollView, Text, View } from "react-native";

import { EntryRow } from "@/catalog/EntryRow";
import { CELL } from "@/catalog/grid";
import { Hairline } from "@/catalog/Hairline";
import { IconButton } from "@/components/IconButton";
import { pressedRect } from "@/motion/pressedRect";
import { openOverlay } from "@/overlay/overlay";

import { setSongSort, useSongSort, type SongListKind } from "./songSort";

const same = (a: SongSort, b: SongSort): boolean =>
  a.key === b.key && a.descending === b.descending;

/** The sorts on offer, the current one checked; choosing one closes the card. */
function SortMenu({ kind, close }: { kind: SongListKind; close: () => void }) {
  const current = useSongSort(kind);
  const sorts = songSortsFor(kind);
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
      {/* Scrolls only where the card can't fit every sort (small windows, landscape). */}
      <ScrollView bounces={false} overScrollMode="never" style={{ flexShrink: 1 }}>
        {sorts.map((sort, index) => (
          <EntryRow
            key={songSortLabel(sort)}
            label={songSortLabel(sort)}
            selected={same(sort, current)}
            divider={index < sorts.length - 1}
            onPress={() => {
              setSongSort(kind, sort);
              close();
            }}
          />
        ))}
      </ScrollView>
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
    <View style={{ marginRight: -12 }}>
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
