import {
  IconCircle,
  IconCircleCheckFilled,
  IconCircleArrowDownFilled,
  IconFileOff,
  IconStarFilled,
} from "@tabler/icons-react-native";
import { swipeActionLabels, type RowMenuAction, type RowSwipeSide } from "@wave/core";
import { memo, useCallback, useMemo, type ReactNode } from "react";
import {
  Text,
  View,
  type AccessibilityActionEvent,
  type AccessibilityActionInfo,
} from "react-native";

import { Artwork } from "@/catalog/Artwork";
import { SONG_ROW_COVER, SongCover } from "@/catalog/cards/SongCard";
import { ExplicitBadge } from "@/catalog/ExplicitBadge";
import { CELL, grid } from "@/catalog/grid";
import { RankNumber } from "@/catalog/RankNumber";
import { SwipeableRow, swipeAccessibility, type SwipeSide } from "@/catalog/SwipeableRow";
import { WavyUnderline } from "@/catalog/WavyUnderline";
import { Press } from "@/motion/Press";
import { useRenderCount } from "@/perf/perf";
import { useThemeColor } from "@/theme/useThemeColor";
import type { SongRowPresentation } from "./songListModel";

export interface SongRowActions {
  readonly onPress: (key: string) => void;
  readonly onLongPress?: ((key: string) => void) | undefined;
  /** [action] is the direction's entry, as the row offered it. */
  readonly onSwipe?: ((key: string, side: RowSwipeSide, action: RowMenuAction) => void) | undefined;
  readonly swipeRight?: RowMenuAction | null | undefined;
  readonly swipeLeft?: RowMenuAction | null | undefined;
  /** Remove from Playlist takes the row out at once: it slides out as it goes. */
  readonly removes?: boolean | undefined;
  /** Screen-reader actions besides the swipes' (a playlist's Move up), from a stable list. */
  readonly extraActions?: readonly AccessibilityActionInfo[] | undefined;
  readonly onExtraAction?: ((key: string, name: string) => void) | undefined;
  readonly accessibilityHint?: string | undefined;
  /**
   * Controls after the row's pressable part, sliding with it (a playlist's
   * grip, Up Next's remove and grip). Keep the node stable, or the row renders again.
   */
  readonly accessory?: ReactNode;
  /** The placeholder cover's colour (the Design preview's synthetic songs). */
  readonly tint?: string | undefined;
}

const NO_ACTIONS: readonly AccessibilityActionInfo[] = [];

/** One memoized song leaf. Its list owns all changing stores and menu planning. */
export const SongRow = memo(function SongRow(props: SongRowPresentation & SongRowActions) {
  useRenderCount("SongRow");
  const [highlight, tertiary, accent] = useThemeColor(["highlight", "tertiary", "accent"]);
  const { rowKey, onPress, onLongPress, onSwipe, swipeRight, swipeLeft, removes } = props;
  const { extraActions = NO_ACTIONS, onExtraAction } = props;
  const press = useCallback(() => onPress(rowKey), [onPress, rowKey]);
  const longPress = useCallback(() => onLongPress?.(rowKey), [onLongPress, rowKey]);
  const extra = useCallback(
    (event: AccessibilityActionEvent) => onExtraAction?.(rowKey, event.nativeEvent.actionName),
    [onExtraAction, rowKey],
  );
  const swipe = useMemo(() => {
    if (props.selecting || props.disabled || onSwipe === undefined) return undefined;
    const side = (
      action: RowMenuAction | null | undefined,
      direction: RowSwipeSide,
    ): SwipeSide | null =>
      action == null
        ? null
        : {
            action,
            ...swipeActionLabels(action),
            leaves: removes === true && action === "removeFromPlaylist",
            run: () => onSwipe(rowKey, direction, action),
          };
    const right = side(swipeRight, "right");
    const left = side(swipeLeft, "left");
    return right === null && left === null ? undefined : { right, left };
  }, [rowKey, onSwipe, swipeRight, swipeLeft, removes, props.selecting, props.disabled]);
  const actions =
    swipe === undefined
      ? extraActions.length === 0
        ? {}
        : { accessibilityActions: [...extraActions], onAccessibilityAction: extra }
      : swipeAccessibility(swipe, extraActions, extra);
  if (props.recycleType === "loadingRow")
    return (
      <View
        accessible
        accessibilityLabel={props.accessibilityLabel}
        className="flex-row items-center"
        style={{ height: grid.row }}
      >
        <Artwork uri={undefined} size={CELL * 5} radius={CELL / 2} />
      </View>
    );
  const fileIcon = <IconFileOff size={18} color={tertiary} strokeWidth={1.5} />;
  const row = (
    <Press
      accessibilityRole={props.accessibilityRole}
      accessibilityLabel={props.accessibilityLabel}
      accessibilityHint={props.accessibilityHint}
      accessibilityState={
        props.selecting
          ? { disabled: props.disabled, checked: props.checked }
          : { disabled: props.disabled, selected: props.playing }
      }
      disabled={props.disabled}
      onPress={press}
      onLongPress={onLongPress === undefined || props.selecting ? undefined : longPress}
      {...actions}
      depth={0.015}
    >
      <View
        className={`flex-row items-center ${props.dimmed ? "opacity-45" : ""}`}
        style={{ height: grid.row, gap: CELL * 1.5 }}
      >
        {props.selecting && (
          <View className="items-center" style={{ width: grid.stateCell }}>
            {props.checked ? (
              <IconCircleCheckFilled size={24} color={accent} />
            ) : (
              <IconCircle size={24} color={tertiary} strokeWidth={1.5} />
            )}
          </View>
        )}
        {props.leading === "artwork" || props.leading === "playDisc" ? (
          props.leading === "playDisc" ? (
            <SongCover
              uri={props.artworkUri}
              tint={props.tint}
              size={CELL * 5}
              {...SONG_ROW_COVER}
            />
          ) : props.fadedCover ? (
            <View className="opacity-45">
              <Artwork uri={props.artworkUri} size={CELL * 5} />
            </View>
          ) : (
            <Artwork uri={props.artworkUri} tint={props.tint} size={CELL * 5} />
          )
        ) : !props.fileNotFound && props.number !== undefined ? (
          <RankNumber rank={props.number} top={props.top} />
        ) : (
          <View className="items-center" style={{ width: grid.stateCell }}>
            {props.fileNotFound && fileIcon}
          </View>
        )}
        <View className="flex-1">
          <View className="flex-row items-center" style={{ gap: CELL / 2 }}>
            <View style={{ flexShrink: 1 }}>
              <Text
                numberOfLines={1}
                className={`font-sans text-body font-medium ${props.playing ? "text-highlight" : props.fileNotFound || props.fadedCover ? "text-secondary" : "text-foreground"}`}
              >
                {props.title}
              </Text>
              {props.playing && <WavyUnderline />}
            </View>
            {props.explicit && <ExplicitBadge />}
          </View>
          <View className="flex-row items-center" style={{ gap: CELL / 2 }}>
            {props.downloaded && <IconCircleArrowDownFilled size={14} color={accent} />}
            <Text numberOfLines={1} className="flex-1 font-sans text-body text-secondary">
              {props.secondLine}
            </Text>
          </View>
          {props.progress !== null && (
            <View className="bg-separator" style={{ height: 2, marginTop: CELL / 2 }}>
              <View
                className="bg-accent"
                style={{ height: 2, width: `${Math.round(props.progress * 100)}%` }}
              />
            </View>
          )}
        </View>
        {props.fileNotFoundIcon === "trailing" && (
          <View className="items-center" style={{ width: CELL * 3 }}>
            {fileIcon}
          </View>
        )}
        {props.trailing && (
          <View className="items-center" style={{ width: CELL * 3 }}>
            {props.starred && <IconStarFilled size={14} color={highlight} />}
          </View>
        )}
        {props.trailing && (
          <Text
            numberOfLines={1}
            className="font-sans text-footnote text-secondary"
            style={{
              fontVariant: ["tabular-nums"],
              ...(props.wideTrailing ? { minWidth: CELL * 9 } : { width: CELL * 5 }),
              textAlign: "right",
            }}
          >
            {props.trailingText}
          </Text>
        )}
      </View>
    </Press>
  );
  const full =
    props.accessory === undefined ? (
      row
    ) : (
      <View className="flex-row items-center">
        <View className="flex-1">{row}</View>
        {props.accessory}
      </View>
    );
  return swipe === undefined ? full : <SwipeableRow swipe={swipe}>{full}</SwipeableRow>;
});
