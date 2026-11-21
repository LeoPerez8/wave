import type { DiscoverRowId, LibraryTotals, ListeningTotals, RecapPeriod } from "@wave/core";
import type { Page } from "./bridge.ts";
import type { BrowseRow } from "./browse.ts";

export type LocalHomeSectionId =
  | "in-your-orbit"
  | "recently-added"
  | "recently-played"
  | "most-played"
  | "most-played-albums"
  | "most-played-artists"
  | "favorites";
/** The shelves whose See all opens their own page (`home.seeAll`). */
export const HOME_SEE_ALL_SECTIONS = ["recently-added", "recently-played"] as const;
export type HomeSeeAllSection = (typeof HOME_SEE_ALL_SECTIONS)[number];
export interface HomeRow extends BrowseRow {
  readonly playCount?: number;
}
export interface HomeSectionView {
  readonly id: LocalHomeSectionId | "discover" | "new-releases" | "upcoming-shows" | "stats";
  readonly kind: "album" | "artist" | "song" | "discover" | "follow" | "stats";
  readonly rows: Page<HomeRow>;
}
export interface HomeView extends Page<HomeSectionView> {
  readonly discoverRows: readonly DiscoverRowId[];
  readonly hint: "empty" | "play" | "none" | null;
  /** The Recap Home's card announces (Core's `recapToAnnounce`); null once it was opened. */
  readonly recap: RecapPeriod | null;
  readonly stats?: {
    readonly library: LibraryTotals;
    readonly listening: ListeningTotals;
  };
}
