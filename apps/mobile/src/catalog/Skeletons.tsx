import type { ReactNode } from "react";
import { View } from "react-native";

import { CELL, grid } from "./grid";
import { SkeletonLine as Line } from "./SkeletonLine";

/*
 * Placeholders in the shape of what's coming, while online content loads.
 * They hold still: an animated pulse would make the glass chrome re-blur on
 * every frame (issue #93), and stillness is what reduce motion asks for anyway.
 */

/** Hides a placeholder from screen readers: its group (or the page) says it's loading. */
const HIDDEN = {
  accessibilityElementsHidden: true,
  importantForAccessibility: "no-hide-descendants",
} as const;

/**
 * Placeholders heard as one element: a screen reader reads [label]
 * ("Loading songs") and that it's busy, and nothing inside.
 */
export function SkeletonGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <View accessible accessibilityLabel={label} accessibilityState={{ busy: true }}>
      <View {...HIDDEN}>{children}</View>
    </View>
  );
}

/** As `TrackRow`'s thumbnail. */
const THUMB = CELL * 5;

/** As `TrackRow`'s gap between its cells. */
const ROW_GAP = CELL * 1.5;

/**
 * What ends a track row: `TrackRow`'s favorite cell and length, or an Up Next
 * row's two cells (remove and the drag handle, `nowPlaying/QueueView.tsx`).
 */
type SkeletonTrailing = "length" | "queue";

/** A track row's leading: a square cover, a song card's cover (Search's songs), or a number. */
type TrackLeading = "artwork" | "card" | "number";

/**
 * A track row's stand-in, laid out as `TrackRow` is: the leading cover square
 * (or a numbered list's number), two lines (body), the favorite cell and the
 * length; or as an Up Next row is, ending in the space of its two cells.
 */
function TrackRowSkeleton({
  leading = "artwork",
  trailing = "length",
}: {
  leading?: TrackLeading;
  trailing?: SkeletonTrailing;
}) {
  const start = (
    <>
      {leading !== "number" ? (
        // A song card's cover has 4dp corners; the others are square.
        <View
          className="bg-fill"
          style={{ width: THUMB, height: THUMB, borderRadius: leading === "card" ? CELL / 2 : 0 }}
        />
      ) : (
        <View style={{ width: grid.stateCell }}>
          <Line lineHeight={22} width="50%" />
        </View>
      )}
      <View className="flex-1">
        <Line lineHeight={22} width="60%" />
        <Line lineHeight={22} width="40%" />
      </View>
    </>
  );
  if (trailing === "queue")
    // As an Up Next row: the gap only runs between cover and lines, its end cells sit flush.
    return (
      <View className="flex-row items-center" style={{ height: grid.row }}>
        <View className="flex-1 flex-row items-center" style={{ gap: ROW_GAP }}>
          {start}
        </View>
        <View style={{ width: grid.upNextTrailing }} />
      </View>
    );
  return (
    <View className="flex-row items-center" style={{ height: grid.row, gap: ROW_GAP }}>
      {start}
      <View style={{ width: CELL * 3 }} />
      <View style={{ width: CELL * 5 }}>
        <Line lineHeight={18} width="70%" />
      </View>
    </View>
  );
}

/** How many skeleton rows stand for songs to come. */
export const SKELETON_ROWS = 3;

/** [count] track row skeletons, heard as one busy group ("Loading songs"). */
export function TrackSkeletons({
  label = "Loading songs",
  count = SKELETON_ROWS,
  leading,
  trailing,
}: {
  label?: string;
  count?: number;
  leading?: TrackLeading;
  trailing?: SkeletonTrailing;
}) {
  return (
    <SkeletonGroup label={label}>
      {Array.from({ length: count }, (_, index) => (
        <TrackRowSkeleton key={index} leading={leading} trailing={trailing} />
      ))}
    </SkeletonGroup>
  );
}

/**
 * An album tile's stand-in, laid out as `AlbumTile` is at [size]: the
 * artwork's square, the caption line, two title lines and the furniture line
 * (their line heights are global.css's catalog, body and footnote).
 */
export function TileSkeleton({ size }: { size: number }) {
  return (
    <View style={{ width: size }}>
      <View className="bg-fill" style={{ width: size, height: size }} />
      <View style={{ paddingTop: CELL * 1.5, gap: CELL / 4 }}>
        <Line lineHeight={16} width="60%" />
        <View style={{ minHeight: CELL * 5.5 }}>
          <Line lineHeight={22} width="85%" />
        </View>
        <Line lineHeight={18} width="35%" />
      </View>
    </View>
  );
}

/** How many skeleton tiles stand for releases to come: enough to run past the screen's edge. */
export const SKELETON_TILES = 3;

/** One Play or Shuffle action's stand-in: its icon and its label. */
function ActionSkeleton() {
  return (
    <View className="flex-row items-center" style={{ gap: CELL }}>
      <View className="bg-fill" style={{ width: 24, height: 24 }} />
      <View style={{ width: CELL * 7 }}>
        <Line lineHeight={22} width="100%" />
      </View>
    </View>
  );
}

/**
 * Play and Shuffle's stand-in, on a line as tall as theirs. Screen readers
 * skip it: the songs' skeleton below says the page is loading.
 */
export function PlayShuffleSkeleton() {
  return (
    <View
      {...HIDDEN}
      className="flex-row items-center"
      style={{ minHeight: 48, columnGap: CELL * 4 }}
    >
      <ActionSkeleton />
      <ActionSkeleton />
    </View>
  );
}

/**
 * A line of text's stand-in that screen readers skip (a page head's detail
 * line, a name not known yet), [width] wide, as tall as its type's line.
 */
export function HiddenSkeletonLine({
  lineHeight,
  width,
}: {
  lineHeight: number;
  width: `${number}%`;
}) {
  return (
    <View {...HIDDEN}>
      <Line lineHeight={lineHeight} width={width} />
    </View>
  );
}

/**
 * A picture's stand-in that screen readers skip (a page head's cover or
 * portrait not known yet): a still fill box, [width] by [height], rounded by
 * [radius].
 */
export function HiddenSkeletonBox({
  width,
  height,
  radius,
}: {
  width: number;
  height: number;
  radius?: number;
}) {
  return <View {...HIDDEN} className="bg-fill" style={{ width, height, borderRadius: radius }} />;
}
