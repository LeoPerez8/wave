import type { DiscoverRowId } from "@wave/core";
import type { Page } from "./bridge.ts";
import type { BrowseRow } from "./browse.ts";

export type LocalHomeSectionId =
  | "recently-added"
  | "recently-played"
  | "most-played"
  | "most-played-albums"
  | "most-played-artists"
  | "favorites";
export interface HomeRow extends BrowseRow {
  readonly playCount?: number;
}
export interface HomeSectionView {
  /** The two follow sections carry no rows: their cards come by `home.follow`. */
  readonly id: LocalHomeSectionId | "discover" | "new-releases" | "upcoming-shows";
  readonly kind: "album" | "artist" | "song" | "discover" | "follow";
  readonly rows: Page<HomeRow>;
}
export interface HomeView extends Page<HomeSectionView> {
  readonly discoverRows: readonly DiscoverRowId[];
  readonly hint: "empty" | "play" | "none" | null;
}
