import {
  ITEM_ACTION_LABELS,
  UNAVAILABLE_ENTRY_ACTION_LABELS,
  actionBarLabel,
  isDestructiveAction,
  itemActions,
  rowSwipeActions,
  type ItemActionEntry,
  type PlaylistPlace,
  type RowMenuAction,
  type RowSwipeActions,
  type RowSwipeSide,
  type UnsearchedSong,
} from "@wave/core";
import { useMemo } from "react";

import { NO_SWIPE, type RowSwipe, type SwipeSide } from "@/catalog/SwipeableRow";
import { favoriteIdsNow } from "@/library/favorites";
import type { ArtistRow, SongRow, SongSummary } from "@/library/LibraryStore";
import { currentPath, useCurrentPath } from "@/library/routes";
import { songsWithIds } from "@/library/sectionSongs";
import { showError } from "@/overlay/alert";
import { lyricsAndGenreLookupsEnabled } from "@/settings/lyricsAndGenre";
import { currentLibraryFinder, type FindInLibrary } from "@/ytmusic/libraryFinder";

import { hasStreamedSongs, targetFacts, type ActionItems } from "./actionTargets";
import { itemActionPress } from "./itemActions";

/**
 * Song rows' swipes (`SwipeableRow`): each direction runs an entry of the
 * row's own long-press menu, the one Core's `rowSwipeActions` picks, and runs
 * it as the menu does (the same toast, the same confirmation).
 *
 * A list mounts many rows, so a row follows nothing to work out its swipe:
 * it reads the route and the stars as it renders (its list renders it again
 * when its star changes), and reads them afresh when a swipe runs.
 */

/** Where a row is shown, for what its swipes do. */
export interface RowSwipeOptions {
  /** The row's place in the playlist it's shown in: its menu, and so its swipe, removes it from there. */
  readonly playlistItem?: PlaylistPlace | undefined;
  /**
   * Runs instead of the menu's Remove from Playlist: the playlist takes the
   * row out at once, so it slides out as it goes.
   */
  readonly onRemove?: (() => void) | undefined;
}

/**
 * The entry of a row's [menu] each direction runs. The one place the swipes'
 * settings come in: Wave's defaults for now.
 */
export const swipeActionsOf = <A extends RowMenuAction>(menu: readonly A[]): RowSwipeActions<A> =>
  rowSwipeActions(menu);

const fullLabel = (action: RowMenuAction): string =>
  action === "search" ? UNAVAILABLE_ENTRY_ACTION_LABELS[action] : ITEM_ACTION_LABELS[action];

const shortLabel = (action: RowMenuAction): string =>
  action === "search" ? UNAVAILABLE_ENTRY_ACTION_LABELS[action] : actionBarLabel(action);

/**
 * A row's swipe from its long-press menu's actions ([menu]), [run] doing what
 * the entry a direction ([side]) shows does: Remove from Playlist, Delete
 * and Remove from Library uncover in red; [onRemove] stands in for Remove
 * from Playlist.
 */
export const rowSwipe = <A extends RowMenuAction>(
  menu: readonly A[],
  run: (action: A, side: RowSwipeSide) => void,
  { onRemove }: RowSwipeOptions = {},
): RowSwipe => {
  const { right, left } = swipeActionsOf(menu);
  const side = (action: A | null, towards: RowSwipeSide): SwipeSide | null => {
    if (action === null) return null;
    const removes = action === "removeFromPlaylist" && onRemove !== undefined;
    return {
      action,
      label: shortLabel(action),
      accessibilityLabel: fullLabel(action),
      destructive:
        action === "removeFromPlaylist" || (action !== "search" && isDestructiveAction(action)),
      leaves: removes,
      run: removes ? onRemove : () => run(action, towards),
    };
  };
  return { right: side(right, "right"), left: side(left, "left") };
};

/**
 * The entry [side] runs on [entries] (a menu as it is now), or none: the
 * menu may have changed since the row showed it (a star, a download), and
 * the swipe runs what the direction stands for now.
 */
export const swipeEntryNow = <E extends { readonly action: RowMenuAction }>(
  entries: readonly E[],
  side: RowSwipeSide,
): E | undefined => {
  const action = swipeActionsOf(entries.map((entry) => entry.action))[side];
  return action === null ? undefined : entries.find((entry) => entry.action === action);
};

const nothing = (): void => undefined;
const findNothing: FindInLibrary = () => null;

/**
 * [target]'s menu entries as its long-press menu plans them on the screen at
 * [here] (Core's `itemActions`), the stars as they are now. Its streamed
 * artists aren't resolved: Go to Artist on a streamed song isn't among them.
 */
const planTrack = (
  target: ActionItems,
  here: string,
  find: FindInLibrary,
): readonly ItemActionEntry<ArtistRow>[] =>
  itemActions<ArtistRow>({
    kind: "track",
    items: targetFacts(target, favoriteIdsNow(), find),
    surface: "menu",
    selectable: false,
    onlineLookups: lyricsAndGenreLookupsEnabled(),
    here,
  });

/**
 * Runs what swiping towards [side] does on [target] now, as its menu would:
 * the entry planned for it, pressed through `itemActionPress`. Streamed
 * songs among it are first looked up in the Library.
 */
const runTrackSwipe = (target: ActionItems, side: RowSwipeSide): void => {
  const here = currentPath();
  const press = (find: FindInLibrary) => {
    const entry = swipeEntryNow(planTrack(target, here, find), side);
    if (entry !== undefined)
      itemActionPress({ target, surface: "menu", finish: nothing, here, find })(entry)();
  };
  if (!hasStreamedSongs(target)) press(findNothing);
  else
    currentLibraryFinder()
      .then(press)
      .catch((error: unknown) => showError("Couldn't load the song", error));
};

/** A Library song's or unsearched entry's swipe, from the menu `openTrackActions` opens. */
const useTrackItemSwipe = (target: ActionItems, options: RowSwipeOptions): RowSwipe => {
  const here = useCurrentPath(false);
  if (target.items.length === 0) return NO_SWIPE;
  return rowSwipe(
    planTrack(target, here, findNothing).map((entry) => entry.action),
    (_, side) => runTrackSwipe(target, side),
    options,
  );
};

/**
 * What swiping a Library [song]'s row runs (none for null, so a row of
 * several kinds can ask for each).
 */
export const useSongSwipe = (song: SongRow | null, options: RowSwipeOptions = {}): RowSwipe => {
  const { playlistItem } = options;
  const target = useMemo<ActionItems>(
    () => ({ kind: "track", items: song === null ? [] : [{ song, playlistItem }] }),
    [song, playlistItem],
  );
  return useTrackItemSwipe(target, options);
};

/** What swiping a playlist's unsearched entry runs (none for null). */
export const useUnsearchedSwipe = (
  song: UnsearchedSong | null,
  options: RowSwipeOptions = {},
): RowSwipe => {
  const { playlistItem } = options;
  const target = useMemo<ActionItems>(
    () => ({ kind: "track", items: song === null ? [] : [{ unsearched: song, playlistItem }] }),
    [song, playlistItem],
  );
  return useTrackItemSwipe(target, options);
};

/**
 * What swiping a row of Library › Songs runs. A paged row holds only what it
 * shows ([summary]), so its directions come from what that says (whether
 * it's a missing song, whether it's starred), and the song's full row is
 * read when one runs, as its menu reads it before opening.
 */
export const useSongSummarySwipe = (summary: SongSummary | undefined): RowSwipe => {
  const here = useCurrentPath(false);
  if (summary === undefined) return NO_SWIPE;
  const { id } = summary;
  const menu = itemActions({
    kind: "track",
    items: [{ missing: !summary.hasFile, favorite: favoriteIdsNow().has(id) }],
    here,
  }).map((entry) => entry.action);
  return rowSwipe(menu, (_, side) => {
    songsWithIds([id])
      .then(([song]) => {
        if (song !== undefined) runTrackSwipe({ kind: "track", items: [{ song }] }, side);
      })
      .catch((error: unknown) => showError("Couldn't load the song", error));
  });
};
