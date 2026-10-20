import {
  ITEM_ACTION_LABELS,
  UNAVAILABLE_ENTRY_ACTION_LABELS,
  actionBarLabel,
  isDestructiveAction,
  itemActions,
  rowSwipeActions,
  type ItemAction,
  type ItemActionEntry,
  type PlaylistPlace,
  type RowMenuAction,
  type UnsearchedSong,
} from "@wave/core";
import { usePathname } from "expo-router";
import { useMemo } from "react";

import { NO_SWIPE, type RowSwipe, type SwipeSide } from "@/catalog/SwipeableRow";
import { useFavoriteIds } from "@/library/favorites";
import type { ArtistRow, SongRow, SongSummary } from "@/library/LibraryStore";
import { songsWithIds } from "@/library/sectionSongs";
import { showError } from "@/overlay/alert";
import { useLibraryFinder, type FindInLibrary } from "@/ytmusic/libraryFinder";

import { hasStreamedSongs, targetFacts, type ActionItems } from "./actionTargets";
import { itemActionPress, usePlannedActions } from "./itemActions";

/**
 * Song rows' swipes (`SwipeableRow`): each direction runs an entry of the
 * row's own long-press menu, the one Core's `rowSwipeActions` picks, and runs
 * it as the menu does (the same toast, the same confirmation).
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

const fullLabel = (action: RowMenuAction): string =>
  action === "search" ? UNAVAILABLE_ENTRY_ACTION_LABELS[action] : ITEM_ACTION_LABELS[action];

const shortLabel = (action: RowMenuAction): string =>
  action === "search" ? UNAVAILABLE_ENTRY_ACTION_LABELS[action] : actionBarLabel(action);

/**
 * A row's swipe from its long-press menu's actions ([menu]), [run] doing what
 * each does: Remove from Playlist, Delete and Remove from Library uncover in
 * red; [onRemove] stands in for Remove from Playlist.
 */
export const rowSwipe = <A extends RowMenuAction>(
  menu: readonly A[],
  run: (action: A) => void,
  { onRemove }: RowSwipeOptions = {},
): RowSwipe => {
  const { right, left } = rowSwipeActions(menu);
  const side = (action: A | null): SwipeSide | null => {
    if (action === null) return null;
    const removes = action === "removeFromPlaylist" && onRemove !== undefined;
    return {
      action,
      label: shortLabel(action),
      accessibilityLabel: fullLabel(action),
      destructive:
        action === "removeFromPlaylist" || (action !== "search" && isDestructiveAction(action)),
      leaves: removes,
      run: removes ? onRemove : () => run(action),
    };
  };
  return { right: side(right), left: side(left) };
};

const nothing = (): void => undefined;
const findNothing: FindInLibrary = () => null;

/**
 * Runs [action] on [target]'s menu entries ([planned]) as its menu would: the
 * entry Core's `itemActions` gave for it, pressed through `itemActionPress`.
 */
const runPlanned = (
  target: ActionItems,
  planned: readonly ItemActionEntry<ArtistRow>[],
  action: ItemAction,
  here: string,
  find: FindInLibrary,
): void => {
  const entry = planned.find((planned) => planned.action === action);
  if (entry === undefined) return;
  itemActionPress({ target, surface: "menu", finish: nothing, here, find })(entry)();
};

/** A Library song's or unsearched entry's swipe, from the menu `openTrackActions` opens. */
const useTrackItemSwipe = (target: ActionItems, options: RowSwipeOptions): RowSwipe => {
  const here = usePathname();
  const favorites = useFavoriteIds();
  const find = useLibraryFinder(hasStreamedSongs(target));
  const planned = usePlannedActions(target, favorites, { surface: "menu", selectable: false });
  if (target.items.length === 0) return NO_SWIPE;
  return rowSwipe(
    planned.map((entry) => entry.action),
    (action) => runPlanned(target, planned, action, here, find),
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
  const here = usePathname();
  const favorites = useFavoriteIds();
  if (summary === undefined) return NO_SWIPE;
  const { id } = summary;
  const menu = itemActions({
    kind: "track",
    items: [{ missing: !summary.hasFile, favorite: favorites.has(id) }],
    here,
  }).map((entry) => entry.action);
  return rowSwipe(menu, (action) => {
    songsWithIds([id])
      .then(([song]) => {
        if (song === undefined) return;
        const target: ActionItems = { kind: "track", items: [{ song }] };
        const planned = itemActions<ArtistRow>({
          kind: "track",
          items: targetFacts(target, favorites, findNothing),
          here,
        });
        runPlanned(target, planned, action, here, findNothing);
      })
      .catch((error: unknown) => showError("Couldn't load the song", error));
  });
};
