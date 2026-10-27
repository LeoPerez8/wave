import {
  LegendList,
  type LegendListRef,
  type LegendListProps,
  type LegendListRenderItemProps,
} from "@legendapp/list/react-native";
import { Fragment, useCallback, useMemo } from "react";
import type { ReactNode, Ref } from "react";
import { View } from "react-native";

import { AlphabetSpine } from "@/catalog/AlphabetSpine";
import { CatalogLine } from "@/catalog/CatalogLine";
import { CELL, grid } from "@/catalog/grid";
import type { Spine } from "@/library/useSpine";

import { useSongRows, type SongRowsOptions } from "./useSongRows";

export type { SongListSelection } from "./useSongRows";

export type SongListProps<T> = Omit<
  LegendListProps<T>,
  "renderItem" | "getItemType" | "getFixedItemSize" | "recycleItems" | "data" | "keyExtractor"
> &
  SongRowsOptions<T> & {
    readonly ref?: Ref<LegendListRef> | undefined;
    readonly spine?: Spine | undefined;
    readonly renderSlot?: ((props: LegendListRenderItemProps<T>) => ReactNode) | undefined;
    readonly slotType?: ((item: T) => string) | undefined;
    /** A slot's fixed height (default one row); undefined lets it size itself. */
    readonly slotSize?: ((item: T) => number | undefined) | undefined;
  };

/** The list owns subscriptions. Recycled leaves receive primitive display props and stable actions. */
export function SongList<T>({
  data,
  keyExtractor,
  song,
  context,
  onPlay,
  onMenu,
  onSongSwipe,
  onSongRemove,
  selection,
  rowActions,
  onRowAction,
  decorateRow,
  spine,
  renderSlot,
  slotType,
  slotSize,
  extraData,
  ...list
}: SongListProps<T>) {
  const rows = useSongRows({
    data,
    keyExtractor,
    song,
    context,
    onPlay,
    onMenu,
    onSongSwipe,
    onSongRemove,
    selection,
    rowActions,
    onRowAction,
    decorateRow,
  });
  const { render, model } = rows;
  const row = useCallback(
    (props: LegendListRenderItemProps<T>) => {
      const { item, index } = props;
      const entry = song(item);
      if (entry === null) return renderSlot?.(props) ?? null;
      if (entry.source.kind === "discHeader") {
        const shown = model.row(entry.source, {}, keyExtractor(item, index));
        return (
          <View
            className="justify-end"
            style={{ height: CELL * 6, paddingBottom: CELL }}
            accessibilityRole={shown.accessibilityRole}
            accessibilityLabel={shown.accessibilityLabel}
          >
            <CatalogLine>{shown.title}</CatalogLine>
          </View>
        );
      }
      return render(item, index);
    },
    [song, renderSlot, model, keyExtractor, render],
  );
  const state = useMemo(() => ({ rows: rows.state, extraData }), [rows.state, extraData]);
  return (
    <>
      <LegendList
        {...list}
        data={data}
        keyExtractor={keyExtractor}
        renderItem={row}
        extraData={state}
        recycleItems
        estimatedItemSize={grid.row}
        getItemType={(item) => {
          const entry = song(item);
          return entry === null
            ? `slot:${slotType?.(item) ?? "custom"}`
            : model.identity(entry.source).recycleType;
        }}
        getFixedItemSize={(item) => {
          const entry = song(item);
          return entry === null
            ? slotSize === undefined
              ? grid.row
              : slotSize(item)
            : entry.source.kind === "discHeader"
              ? CELL * 6
              : grid.row;
        }}
      />
      {spine?.show && (
        <AlphabetSpine entries={spine.entries} onJump={spine.onJump} topRow={spine.topRow} />
      )}
    </>
  );
}

/**
 * A short, capped run of song rows (Home's shelves, Stats' top songs, an
 * artist's Most played), not virtualised: the same rows, subscriptions and
 * handlers as the song list. Its See all uses `SongList`.
 */
export function SongRows<T>(props: SongRowsOptions<T>) {
  const { render } = useSongRows(props);
  return (
    <View>
      {props.data.map((item, index) => (
        <Fragment key={props.keyExtractor(item, index)}>{render(item, index)}</Fragment>
      ))}
    </View>
  );
}
