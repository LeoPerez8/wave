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
  readonly id: LocalHomeSectionId | "discover";
  readonly kind: "album" | "artist" | "song" | "discover";
  readonly rows: Page<HomeRow>;
}
export interface HomeView extends Page<HomeSectionView> {
  readonly discoverRows: readonly DiscoverRowId[];
  readonly hint: "empty" | "play" | "none" | null;
}
