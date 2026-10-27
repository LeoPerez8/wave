import {
  songRowSwipeDirections,
  ITEM_ACTION_LABELS,
  UNAVAILABLE_ENTRY_ACTION_LABELS,
  actionBarLabel,
  itemActions,
  rowSwipeActions,
  swipesChoose,
  type ActionItem,
  type ItemActionEntry,
  type PlaylistPlace,
  type RowMenuAction,
  type RowSwipeActions,
  type RowSwipeSide,
  type SwipeSettings,
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
import { swipeSettingsNow, useSwipeSettings } from "@/settings/swipeActions";
import { currentLibraryFinder, type FindInLibrary } from "@/ytmusic/libraryFinder";
import { streamedArtistContextNow } from "@/ytmusic/streamedArtist";
import { missingSongDownloadStatusNow } from "@/ytmusic/YtDownloads";

import { hasStreamedSongs, isLibraryTrack, targetFacts, type ActionItems } from "./actionTargets";
import { itemActionPress } from "./itemActions";

/**
 * Song rows' swipes (`SwipeableRow`): each direction runs an entry of the
 * row's own long-press menu, the one Core's `rowSwipeActions` picks, and runs
 * it as the menu does (the same toast, the same confirmation).
 *
 * What each direction runs is Settings › Swipe actions' choice
 * (`settings/swipeActions`): a row renders again when that changes.
 *
 * A list mounts many rows, so a row follows nothing else to work out its
 * swipe: it reads the route, the stars and, when a direction is set to them,
 * a download's state and a streamed song's artists as it renders (its list
 * renders it again when its star changes), and reads them afresh when a
 * swipe runs.
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
 * The entry of a row's [menu] each direction runs: the one place the swipes'
 * settings (Settings › Swipe actions, as they are now) come in.
 */
export const swipeActionsOf = <A extends RowMenuAction>(menu: readonly A[]): RowSwipeActions<A> =>
  rowSwipeActions(menu, swipeSettingsNow());

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
 * [here] (Core's `itemActions`), the stars as they are now. What only some
 * swipe choices need is read only while [settings] choose them: a missing
 * song's download (Download), a streamed song's artists (Go to Artist, once
 * the Library's artists are read).
 */
const planTrack = (
  target: ActionItems,
  here: string,
  find: FindInLibrary,
  settings: SwipeSettings,
): readonly ItemActionEntry<ArtistRow>[] => {
  const facts = targetFacts(target, favoriteIdsNow(), find);
  const downloads = swipesChoose(settings, "download");
  const items = target.kind === "track" ? target.items : [];
  return itemActions<ArtistRow>({
    kind: "track",
    items: downloads
      ? facts.map((fact, index): ActionItem => {
          const item = items[index];
          return fact.missing === true && item !== undefined && isLibraryTrack(item)
            ? { ...fact, download: missingSongDownloadStatusNow(item.song.id) }
            : fact;
        })
      : facts,
    surface: "menu",
    selectable: false,
    onlineLookups: lyricsAndGenreLookupsEnabled(),
    here,
    streamedArtists:
      hasStreamedSongs(target) && swipesChoose(settings, "goToArtist")
        ? streamedArtistContextNow()
        : undefined,
  });
};

/**
 * Runs what swiping towards [side] does on [target] now, as its menu would:
 * the entry planned for it, pressed through `itemActionPress`. Go to Artist
 * resolves only its requested artist names; song actions acquire the Library
 * song finder when they need it.
 */
export const runTrackSwipe = (target: ActionItems, side: RowSwipeSide): void => {
  const here = currentPath();
  const settings = swipeSettingsNow();
  const press = (find: FindInLibrary) => {
    const entry = swipeEntryNow(planTrack(target, here, find, settings), side);
    if (entry !== undefined)
      itemActionPress({
        target,
        surface: "menu",
        favoriteSource: "swipe",
        finish: nothing,
        here,
        find,
      })(entry)();
  };
  const chosen = swipeEntryNow(planTrack(target, here, findNothing, settings), side);
  if (!hasStreamedSongs(target) || chosen?.action === "goToArtist") press(findNothing);
  else
    currentLibraryFinder()
      .then(press)
      .catch((error: unknown) => showError("Couldn't load the song", error));
};

/** A Library song's or unsearched entry's swipe, from the menu `openTrackActions` opens. */
const useTrackItemSwipe = (target: ActionItems, options: RowSwipeOptions): RowSwipe => {
  const settings = useSwipeSettings();
  const here = useCurrentPath(false);
  if (!settings.enabled || target.items.length === 0) return NO_SWIPE;
  return rowSwipe(
    planTrack(target, here, findNothing, settings).map((entry) => entry.action),
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
  const settings = useSwipeSettings();
  const here = useCurrentPath(false);
  if (!settings.enabled || summary === undefined) return NO_SWIPE;
  const { id, hasFile } = summary;
  const menu = itemActions({
    kind: "track",
    items: [
      {
        missing: !hasFile,
        favorite: favoriteIdsNow().has(id),
        albumId: summary.albumId,
        artistIds: [summary.artistId],
        fixable: summary.fixable,
        ...(!hasFile && swipesChoose(settings, "download")
          ? { download: missingSongDownloadStatusNow(id) }
          : {}),
      },
    ],
    onlineLookups: lyricsAndGenreLookupsEnabled(),
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

/** Paged lists read full action metadata only when a swipe runs. */
export const runSummarySwipe = (id: number, side: RowSwipeSide): void => {
  songsWithIds([id])
    .then(([song]) => {
      if (song !== undefined) runTrackSwipe({ kind: "track", items: [{ song }] }, side);
    })
    .catch((error: unknown) => showError("Couldn't load the song", error));
};

/** Temporary bridge for #716's remaining TrackRow callers; one subscription per container. */
export const useLibrarySongSwipes = (): ((song: SongRow) => RowSwipe) => {
  const settings = useSwipeSettings();
  const here = useCurrentPath(false);
  return (song) => {
    const target: ActionItems = { kind: "track", items: [{ song }] };
    const item = targetFacts(target, favoriteIdsNow(), findNothing)[0]!;
    const directions = songRowSwipeDirections(
      {
        kind: "track",
        item: {
          ...item,
          download: song.path === null ? missingSongDownloadStatusNow(song.id) : null,
        },
        here,
        onlineLookups: lyricsAndGenreLookupsEnabled(),
      },
      settings,
    );
    const side = (action: RowMenuAction | null, direction: RowSwipeSide): SwipeSide | null =>
      action === null
        ? null
        : {
            action,
            label: shortLabel(action),
            accessibilityLabel: fullLabel(action),
            leaves: false,
            run: () => runTrackSwipe(target, direction),
          };
    return { right: side(directions.right, "right"), left: side(directions.left, "left") };
  };
};
