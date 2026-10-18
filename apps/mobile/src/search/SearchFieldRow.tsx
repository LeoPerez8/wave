import { listActionsForms } from "@wave/core";
import { useState, type ReactNode } from "react";
import { View, type LayoutChangeEvent } from "react-native";

import { CELL, widthOf } from "@/catalog/grid";
import type { LineToggle } from "@/catalog/PlayShuffle";
import { OnlineToggle, OnlineToggleFaces } from "@/ytmusic/OnlineToggle";

/** The least the search field keeps beside a labelled toggle; below it, the toggle shows icons. */
const FIELD_MIN = CELL * 30;
const GAP = CELL * 2;

interface Widths {
  readonly line: number | undefined;
  readonly labelled: number | undefined;
  readonly icons: number | undefined;
}

const NOTHING_MEASURED: Widths = { line: undefined, labelled: undefined, icons: undefined };

/**
 * The search field's row: the field, then, while YT Music is on, the Library
 * | Online toggle at its end. The toggle keeps its labels only when the field
 * keeps room enough beside it, and shows its icons alone otherwise (Core's
 * `listActionsForms`); it's measured ahead, unseen, so it lands on its form
 * at once.
 */
export function SearchFieldRow({ field, toggle }: { field: ReactNode; toggle: LineToggle | null }) {
  const [widths, setWidths] = useState<Widths>(NOTHING_MEASURED);
  const measured = (key: keyof Widths) => (width: number) =>
    setWidths((current) => (current[key] === width ? current : { ...current, [key]: width }));
  const form = listActionsForms(
    {
      line: widths.line,
      gap: GAP,
      before: [FIELD_MIN],
      last: {},
      toggle: { labelled: widths.labelled, icons: widths.icons },
    },
    null,
  ).toggle;
  return (
    <View
      className="flex-row items-center"
      style={{ columnGap: GAP }}
      onLayout={(event: LayoutChangeEvent) => measured("line")(widthOf(event))}
    >
      <View className="flex-1">{field}</View>
      {toggle !== null && form !== null && (
        <OnlineToggle
          selected={toggle.selected}
          onPick={toggle.onPick}
          onLongPress={toggle.onLongPress}
          form={form}
        />
      )}
      {toggle !== null && (
        <View
          pointerEvents="none"
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          className="absolute top-0 left-0 items-start opacity-0"
        >
          <OnlineToggleFaces onLabelled={measured("labelled")} onIcons={measured("icons")} />
        </View>
      )}
    </View>
  );
}
