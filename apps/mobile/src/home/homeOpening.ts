import type { HomePlays, HomeSections } from "@wave/client/db/playHistory";
import { STATS_FACT_LABELS, type HomeItem, type HomeSectionId } from "@wave/core";
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
  // Discover's due checks must not treat an unanswered query as "nothing played".
  played: home.mostPlayed === undefined ? undefined : home.mostPlayed.length > 0,
  ready:
    home.recentlyAdded !== undefined ||
    home.mostPlayed !== undefined ||
    home.favorites !== undefined,
  // All three local payloads have answered; ancillary sections keep their own read boundaries.
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

/**
 * The part of Home's lists the section [id] draws from: its own slice, or for
 * Discover only whether the Library is empty and anything was played. The
 * other sections read their own queries, so none of Home.
 */
const homeSectionReads = (id: HomeSectionId, home: HomeContent): readonly unknown[] => {
  switch (id) {
    case "recently-added":
      return [home.recentlyAdded];
    case "recently-played":
      return [home.recentlyPlayed];
    case "most-played":
      return [home.mostPlayed];
    case "favorites":
      return [home.favorites];
    case "discover": {
      const { empty, played } = homeOpeningState(home);
      return [empty, played];
    }
    default:
      return [];
  }
};

/**
 * Whether the section [id] draws the same from [before] and [after], so a
 * change to another section's slice leaves it alone (#1440).
 */
export const sameHomeSection = (
  id: HomeSectionId,
  before: HomeContent,
  after: HomeContent,
): boolean => {
  const was = homeSectionReads(id, before);
  const is = homeSectionReads(id, after);
  return was.every((value, index) => Object.is(value, is[index]));
};

/** The room a playlist card's sleeves take above its cover (`SLEEVE_ROOM` in `PlaylistCard`). */
const PLAYLIST_SLEEVE_ROOM = 10;

/**
 * The room a local section holds before its first read answers with no
 * snapshot to draw (`HomeSectionSpace`); answered sections use their
 * content's height. Only these reserve space; answered sections use their content's
 * height. [available] is the width inside the screen's margins, which In your
 * orbit's grid fills as the Magic Queue's does (`magicQueueGrid`).
 */
export const homePlaceholderHeight = (
  id: HomeSectionId,
  fontScale: number,
  available: number,
): number => {
  switch (id) {
    case "most-played":
    case "favorites":
      return grid.row * 10;
    case "recently-added":
    case "most-played-albums":
      return CELL * 19 + CELL + 40 * Math.max(1, fontScale);
    // Recently played's playlist cards have their sleeves.
    case "recently-played":
    case "from-your-library":
      return PLAYLIST_SLEEVE_ROOM + CELL * 19 + CELL + 40 * Math.max(1, fontScale);
    case "most-played-artists":
      return CELL * 19 + CELL + 22 * Math.max(1, fontScale);
    case "in-your-orbit":
      return magicQueueGrid(available, fontScale).height;
    case "stats":
      return homeStatsRowLayout(fontScale).minHeight * STATS_FACT_LABELS.length;
    default:
      return 0;
  }
};

/** Space above every section but the first on a screen: what `TitledSection` puts there. */
export const SECTION_GAP = CELL * 5;

/** A section's heading as `TitledSection` draws it: its top margin, its line and the gap under it. */
const SECTION_HEADING = SECTION_GAP + CELL * 6 + CELL * 1.5;

/** DJ's card on Home (`DjCard`): its least height. */
const DJ_CARD = CELL * 21;

/**
 * Sections that often draw nothing (no followed artists, no shows, signed
 * out): their estimate is no height, so the sections after them still mount
 * in Home's first frame when they don't show.
 */
const MAY_DRAW_NOTHING: ReadonlySet<HomeSectionId> = new Set([
  "new-releases",
  "upcoming-shows",
  "community-playlists",
]);

/**
 * How tall an item of Home is taken to be when its first frame decides what
 * to mount (`StagedSections`, Core's `stagedMounts`, #1380): erring short, so
 * the first frame never leaves the bottom of the screen empty. [width] is the
 * window's. Discover counts only the Magic Queue's grid under its heading;
 * DJ its card under the section gap, and nothing with YouTube Music off
 * ([ytMusic]), when it draws nothing. The lines between sections count nothing.
 */
export const homeItemEstimate = (
  item: HomeItem,
  fontScale: number,
  width: number,
  ytMusic: boolean,
): number => {
  if (typeof item === "string") return 0;
  const { section } = item;
  if (MAY_DRAW_NOTHING.has(section)) return 0;
  const available = width - grid.margin * 2;
  if (section === "dj") return ytMusic ? SECTION_GAP + DJ_CARD : 0;
  if (section === "discover") return SECTION_HEADING + magicQueueGrid(available, fontScale).height;
  return SECTION_HEADING + homePlaceholderHeight(section, fontScale, available);
};

/** Stats values move below their labels at large system text sizes. */
export const homeStatsRowLayout = (fontScale: number) => {
  // React Native reports Android fontScale as a 32-bit float (1.3 becomes 1.29999995).
  const stacked = fontScale >= Math.fround(1.3);
  return {
    stacked,
    minHeight: Math.max(CELL * 6, (stacked ? 44 : 22) * Math.max(1, fontScale) + CELL * 2),
  };
};

/**
 * Shared by the Magic Queue's tiles and placeholders, including large-text breakpoints.
 * [height] is that of [count] tiles, nine unless given.
 */
export const magicQueueGrid = (available: number, fontScale: number, count = 9) => {
  const columns = Math.max(
    1,
    Math.min(
      fontScale >= 2 ? 1 : fontScale >= Math.fround(1.3) ? 2 : 3,
      Math.floor((available + CELL) / (CELL * 7)),
    ),
  );
  const size = Math.max(CELL * 6, (available - CELL * (columns - 1)) / columns);
  const rows = Math.ceil(count / columns);
  return {
    available,
    columns,
    size,
    height: rows * (size + CELL + 40 * Math.max(1, fontScale)) + (rows - 1) * CELL,
  };
};
