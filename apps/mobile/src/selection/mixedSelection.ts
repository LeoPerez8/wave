import type { AlbumRow } from "../library/LibraryStore.ts";
import type { YtArtistAlbum } from "@wave/core";
import type { TrackItem } from "../playback/actionTargets.ts";
import { albumItem, ytAlbumItem, type MixedItem } from "../playback/mixedItems.ts";
import type { ListSelection } from "./useListSelection.ts";

const selectionOfItems = <T>(
  page: ListSelection<MixedItem>,
  itemOf: (item: T) => MixedItem,
): ListSelection<T> => ({
  selecting: page.selecting,
  selection: page.selection,
  isChecked: (item) => page.isChecked(itemOf(item)),
  start: (item) => page.start(itemOf(item)),
  toggle: (item) => page.toggle(itemOf(item)),
});

/** The artist page's shared selection as each kind of row sees it. */
export const albumSelectionOf = (page: ListSelection<MixedItem>): ListSelection<AlbumRow> =>
  selectionOfItems(page, albumItem);
export const ytAlbumSelectionOf = (page: ListSelection<MixedItem>): ListSelection<YtArtistAlbum> =>
  selectionOfItems(page, ytAlbumItem);
export const trackSelectionOf = (page: ListSelection<MixedItem>): ListSelection<TrackItem> =>
  selectionOfItems(page, (item) => ({ kind: "track", item }));
