import { useEffect, useRef, useState, type ReactNode } from "react";
import { ScrollView, View, type ScrollViewInstance } from "react-native";

import { CELL, grid } from "@/catalog/grid";
import { useListScrollable } from "@/motion/heldTouch";
import { magicQueueCarouselRestarts, type MagicQueueCarouselRow } from "@wave/core";

/** A page of the carousel: what it draws, under a [key] that stays its own. */
export interface CarouselPage {
  readonly key: string;
  readonly content: ReactNode;
}

/**
 * The Magic Queue carousel's pages side by side, one in sight at a time,
 * swiped sideways and snapping page by page. It takes a list, so a page is
 * added by adding an entry. Each page is [width] wide between the screen's
 * margins, which the row bleeds over so a page slides in from the screen's
 * edge. [index] is the page in sight; a swipe reports the page it lands on
 * through [onIndex], and a change of [index] from outside (the indicator's
 * TalkBack adjust) moves the row there with no animation. A page added or
 * removed before the one in sight starts the row over at that page; one after
 * it changes nothing in sight. Pages out of sight are hidden from screen
 * readers.
 */
export function MagicQueueCarousel({
  pages,
  index,
  onIndex,
  width,
}: {
  pages: readonly CarouselPage[];
  index: number;
  onIndex: (index: number) => void;
  width: number;
}) {
  const pageWidth = width + grid.margin * 2;
  const now: MagicQueueCarouselRow = {
    width: pageWidth,
    pages: pages.map((page) => page.key),
    index,
  };
  // The row starts over at its page when its width or the pages before that page change
  // (`magicQueueCarouselRestarts`); a swipe and a page joining after it leave it mounted.
  const [row, setRow] = useState({ shown: now, starts: 0 });
  const starts = row.starts + (magicQueueCarouselRestarts(row.shown, now) ? 1 : 0);
  if (
    starts !== row.starts ||
    row.shown.index !== index ||
    row.shown.pages.join("|") !== now.pages.join("|")
  )
    setRow({ shown: now, starts });
  return (
    <View style={{ marginHorizontal: -grid.margin }}>
      <CarouselScrollView
        key={starts}
        pages={pages}
        index={index}
        onIndex={onIndex}
        pageWidth={pageWidth}
      />
    </View>
  );
}

function CarouselScrollView({
  pages,
  index,
  onIndex,
  pageWidth,
}: {
  pages: readonly CarouselPage[];
  index: number;
  onIndex: (index: number) => void;
  pageWidth: number;
}) {
  const scrollable = useListScrollable();
  const row = useRef<ScrollViewInstance>(null);
  // Where the row starts, fixed at mount: Android scrolls to a changed `contentOffset`, which
  // would pull a swipe to the page it is only halfway to.
  const [start] = useState(() => ({ x: index * pageWidth, y: 0 }));
  // The page the row itself last scrolled to: a swipe needs no move back to where it already is.
  const at = useRef(index);
  useEffect(() => {
    if (at.current === index) return;
    at.current = index;
    row.current?.scrollTo({ x: index * pageWidth, animated: false });
  }, [index, pageWidth]);
  return (
    <ScrollView
      ref={row}
      horizontal
      pagingEnabled
      scrollEnabled={scrollable}
      showsHorizontalScrollIndicator={false}
      overScrollMode="never"
      scrollEventThrottle={16}
      contentOffset={start}
      // Android can drop the offset of a row not laid out yet: go there once its pages are.
      onContentSizeChange={() => {
        if (at.current > 0) row.current?.scrollTo({ x: at.current * pageWidth, animated: false });
      }}
      onScroll={(event) => {
        const now = Math.round(event.nativeEvent.contentOffset.x / pageWidth);
        if (now === at.current || now < 0 || now >= pages.length) return;
        at.current = now;
        onIndex(now);
      }}
    >
      {pages.map((page, place) => (
        <View
          key={page.key}
          importantForAccessibility={place === index ? "auto" : "no-hide-descendants"}
          style={{ width: pageWidth, paddingHorizontal: grid.margin }}
        >
          {page.content}
        </View>
      ))}
    </ScrollView>
  );
}

const DOT = CELL * 0.75;

/**
 * The carousel's page indicator: a dot per page, the one in sight in the
 * accent. TalkBack hears it as one adjustable control saying [label] (the
 * page's name and its place), whose adjust moves a page forward or back.
 */
export function CarouselPageDots({
  count,
  index,
  label,
  onIndex,
}: {
  count: number;
  index: number;
  label: string;
  onIndex: (index: number) => void;
}) {
  return (
    <View
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel={label}
      accessibilityValue={{ min: 1, max: count, now: index + 1 }}
      accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
      onAccessibilityAction={(event) => {
        const next = index + (event.nativeEvent.actionName === "increment" ? 1 : -1);
        if (next >= 0 && next < count) onIndex(next);
      }}
      className="flex-row items-center"
      style={{ gap: DOT, paddingVertical: CELL / 2 }}
    >
      {Array.from({ length: count }, (_, place) => (
        <View
          key={place}
          className={place === index ? "bg-accent" : "bg-secondary"}
          style={{
            width: DOT,
            height: DOT,
            borderRadius: DOT / 2,
            opacity: place === index ? 1 : 0.4,
          }}
        />
      ))}
    </View>
  );
}
