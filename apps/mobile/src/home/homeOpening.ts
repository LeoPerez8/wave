import type { HomePlays, HomeSections } from "../library/db/playHistory.ts";
import type { HomeSectionId } from "@wave/core";
import { CELL, grid } from "../catalog/grid.ts";

/** Unanswered slices stay undefined; an answered empty slice is content too. */
export type HomeContent = Partial<HomeSections>;

export const homeContent = (
  added: Pick<HomeSections, "recentlyAdded"> | undefined,
  plays: HomePlays | undefined,
  favorites: Pick<HomeSections, "favorites"> | undefined,
): HomeContent => ({ ...added, ...plays, ...favorites });

export const homeOpeningState = (home: HomeContent) => ({
  empty: home.recentlyAdded?.length === 0,
  nothingPlayed: home.recentlyPlayed?.length === 0 && home.mostPlayed?.length === 0,
  ready:
    home.recentlyAdded !== undefined ||
    home.mostPlayed !== undefined ||
    home.favorites !== undefined,
  // Drawing is independent; optional background work still waits for the opening's local content.
  settled:
    home.recentlyAdded !== undefined &&
    home.mostPlayed !== undefined &&
    home.favorites !== undefined,
});

export interface HomeFrames {
  readonly request: (run: () => void) => number;
  readonly cancel: (id: number) => void;
}

/** The first callback precedes paint. Mount read-backed children only on the next frame. */
export const afterHomeFrame = (start: () => void, frames: HomeFrames): (() => void) => {
  let frame = frames.request(() => {
    frame = frames.request(start);
  });
  return () => frames.cancel(frame);
};

/** The local slice a catalogue section needs; other sections have their own queries. */
export const homeSectionWaiting = (id: HomeSectionId, home: HomeContent): boolean => {
  switch (id) {
    case "recently-added":
      return home.recentlyAdded === undefined;
    case "recently-played":
      return home.recentlyPlayed === undefined;
    case "most-played":
      return home.mostPlayed === undefined;
    case "favorites":
      return home.favorites === undefined;
    default:
      return false;
  }
};

/** Match Home's bounded ten-row lists and single-line card captions at system text size. */
export const homeBodyHeight = (id: HomeSectionId, fontScale: number): number => {
  switch (id) {
    case "most-played":
    case "favorites":
      return grid.row * 10;
    case "recently-added":
    case "recently-played":
    case "most-played-albums":
      return CELL * 19 + CELL + 40 * Math.max(1, fontScale);
    case "most-played-artists":
      return CELL * 19 + CELL + 22 * Math.max(1, fontScale);
    case "listening-overview":
      // Each of its two totals groups can wrap to three lines on a narrow screen.
      return 120 * Math.max(1, fontScale) + CELL / 2;
    default:
      return 0;
  }
};

/** Shared by the Magic Queue's tiles and placeholders, including large-text breakpoints. */
export const magicQueueGrid = (available: number, fontScale: number) => {
  const columns = Math.max(
    1,
    Math.min(
      fontScale >= 2 ? 1 : fontScale >= Math.fround(1.3) ? 2 : 3,
      Math.floor((available + CELL) / (CELL * 7)),
    ),
  );
  const size = Math.max(CELL * 6, (available - CELL * (columns - 1)) / columns);
  const rows = Math.ceil(9 / columns);
  return {
    available,
    columns,
    size,
    height: rows * (size + CELL + 40 * Math.max(1, fontScale)) + (rows - 1) * CELL,
  };
};
