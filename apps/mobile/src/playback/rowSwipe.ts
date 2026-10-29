import { currentLocalisation } from "@/localisation/localisation";
import {
  itemActions,
  shownSwipeEntry,
  swipesChoose,
  type ActionItem,
  type ItemActionEntry,
  type PlaylistPlace,
  type RowMenuAction,
  type SwipeSettings,
} from "@wave/core";
import { favoriteIdsNow } from "@/library/favorites";
import type { ArtistRow } from "@/library/LibraryStore";
import { currentPath } from "@/library/routes";
import { songsWithIds } from "@/library/sectionSongs";
import { showError } from "@/overlay/alert";
import { lyricsAndGenreLookupsEnabled } from "@/settings/lyricsAndGenre";
import { swipeSettingsNow } from "@/settings/swipeActions";
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
 * (`settings/swipeActions`). The song list works out a row's two directions
 * as it renders (Core's `songRowSwipeDirections`, no menu built); a swipe
 * plans the menu afresh here, from the route, the stars, the download and
 * the artists as they are when it runs, and runs the entry the row showed
 * (Core's `shownSwipeEntry`), so what it runs can't drift from what it showed.
 */

/** Where a row is shown, for what its swipes do. */
export interface RowSwipeOptions {
  /** The row's place in the playlist it's shown in: its menu, and so its swipe, removes it from there. */
  readonly playlistItem?: PlaylistPlace | undefined;
}

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
 * Runs the swipe [target]'s row showed ([shown]) as its menu would: the
 * entry planned for it now, pressed through `itemActionPress`. Go to Artist
 * resolves only its requested artist names; song actions acquire the Library
 * song finder when they need it.
 */
export const runTrackSwipe = (target: ActionItems, shown: RowMenuAction): void => {
  const here = currentPath();
  const settings = swipeSettingsNow();
  const press = (find: FindInLibrary) => {
    const entry = shownSwipeEntry(planTrack(target, here, find, settings), shown);
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
  if (!hasStreamedSongs(target) || shown === "goToArtist") press(findNothing);
  else
    currentLibraryFinder()
      .then(press)
      .catch((error: unknown) => showError(currentLocalisation().strings.playbackText.couldntLoadTheSong, error));
};

/** Paged lists read full action metadata only when a swipe runs. */
export const runSummarySwipe = (id: number, shown: RowMenuAction): void => {
  songsWithIds([id])
    .then(([song]) => {
      if (song !== undefined) runTrackSwipe({ kind: "track", items: [{ song }] }, shown);
    })
    .catch((error: unknown) => showError(currentLocalisation().strings.playbackText.couldntLoadTheSong, error));
};
