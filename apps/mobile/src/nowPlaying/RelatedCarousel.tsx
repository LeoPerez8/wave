import { Fragment, useCallback, useMemo, useRef, useState } from "react";
import {
  ScrollView,
  View,
  type AccessibilityActionEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type ScrollViewInstance,
} from "react-native";
import { useReducedMotion } from "react-native-reanimated";

import { CELL, grid } from "@/catalog/grid";
import { ClearRowsContext } from "@/catalog/SwipeableRow";
import { useLocalisation } from "@/localisation/localisation";
import { useListScrollable } from "@/motion/heldTouch";
import { useSongRows, type SongRowsOptions } from "@/songs/useSongRows";

/** How much of the next page shows at the right edge, past the gap between pages. */
const PEEK = CELL * 3;
const GAP = grid.gutter;
/** The dots' strip under the pages. */
export const RELATED_DOTS_HEIGHT = CELL * 3;
const DOT = 6;

const ADJUST = [{ name: "increment" }, { name: "decrement" }] as const;

/**
 * Related's songs as pages turned sideways: each page is [pageSize] of
 * [options]' songs, in order, as rows without swipe actions (a sideways swipe
 * always turns the page), which have no background of their own
 * (`ClearRowsContext`), so Now Playing's colours show through. With more than one
 * page the next one's edge shows on the right and dots under the pages mark
 * the one in sight. [width] is the space between the screen's side margins.
 *
 * TalkBack walks the songs in order, the pages turning under its focus; the
 * dots read "Page 2 of 3", say so again as the page turns, and turn it
 * themselves with the volume keys or a swipe up or down.
 */
export function RelatedCarousel<T>({
  pageSize,
  width,
  ...options
}: Omit<SongRowsOptions<T>, "onSongSwipe" | "onSongRemove"> & {
  pageSize: number;
  width: number;
}) {
  const { strings } = useLocalisation();
  const scrollable = useListScrollable();
  const still = useReducedMotion();
  const { render } = useSongRows(options);
  const { data, keyExtractor } = options;
  const pages = useMemo(
    () =>
      Array.from({ length: pageSize > 0 ? Math.ceil(data.length / pageSize) : 0 }, (_, page) =>
        data.slice(page * pageSize, (page + 1) * pageSize),
      ),
    [data, pageSize],
  );
  const many = pages.length > 1;
  const pageWidth = many ? width - GAP - PEEK : width;
  const interval = pageWidth + GAP;
  const [page, setPage] = useState(0);
  const scroll = useRef<ScrollViewInstance>(null);
  const last = pages.length - 1;
  const scrolled = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) =>
      setPage(
        Math.min(last, Math.max(0, Math.round(event.nativeEvent.contentOffset.x / interval))),
      ),
    [interval, last],
  );
  const adjust = useCallback(
    (event: AccessibilityActionEvent) => {
      const next = page + (event.nativeEvent.actionName === "increment" ? 1 : -1);
      if (next < 0 || next > last) return;
      scroll.current?.scrollTo({ x: next * interval, animated: !still });
    },
    [page, last, interval, still],
  );
  return (
    <ClearRowsContext value>
      <ScrollView
        ref={scroll}
        horizontal
        scrollEnabled={scrollable && many}
        showsHorizontalScrollIndicator={false}
        snapToInterval={interval}
        snapToAlignment="start"
        decelerationRate="fast"
        disableIntervalMomentum
        onScroll={scrolled}
        scrollEventThrottle={16}
        style={{ marginHorizontal: -grid.margin, flexGrow: 0 }}
        // The last page rests where the first does, on the left margin.
        contentContainerStyle={{
          paddingLeft: grid.margin,
          paddingRight: grid.margin + (many ? GAP + PEEK : 0),
          gap: GAP,
        }}
      >
        {pages.map((songs, index) => (
          <View key={index} style={{ width: pageWidth }}>
            {songs.map((song, row) => {
              const at = index * pageSize + row;
              return <Fragment key={keyExtractor(song, at)}>{render(song, at)}</Fragment>;
            })}
          </View>
        ))}
      </ScrollView>
      {many && (
        <View
          accessible
          accessibilityRole="adjustable"
          accessibilityLabel={strings.playbackText.pageValueOfValue(page + 1, pages.length)}
          accessibilityLiveRegion="polite"
          accessibilityActions={ADJUST}
          onAccessibilityAction={adjust}
          className="flex-row items-center justify-center"
          style={{ height: RELATED_DOTS_HEIGHT, gap: DOT }}
        >
          {pages.map((_, index) => (
            <View
              key={index}
              className="bg-foreground"
              style={{
                width: DOT,
                height: DOT,
                borderRadius: DOT / 2,
                opacity: index === page ? 1 : 0.3,
              }}
            />
          ))}
        </View>
      )}
    </ClearRowsContext>
  );
}
