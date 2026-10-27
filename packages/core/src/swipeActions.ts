/**
 * Which action each swipe direction runs on a song row. A row swipes to run
 * one of its own long-press menu's entries, so a swipe never does what the
 * menu wouldn't: right adds the song to the queue, left removes it (from the
 * playlist it's shown in, else deleting its file or taking a missing song out
 * of the Library). A direction whose action the row's menu doesn't offer is
 * inert: the row doesn't move that way. How a swipe ends is `resolveRowSwipe`.
 */

import {
  actionBarLabel,
  isDestructiveAction,
  ITEM_ACTION_LABELS,
  type ItemAction,
} from "./itemActions.ts";
import { UNAVAILABLE_ENTRY_ACTION_LABELS, type UnavailableEntryAction } from "./playlistEntries.ts";
import { readStoredRecord } from "./storedJson.ts";

/** An entry of a song row's long-press menu: the Library's, a YT Music song's, an unavailable entry's. */
export type RowMenuAction = ItemAction | UnavailableEntryAction;

/** The theme ink of an uncovered swipe action, at any arming strength. */
export const swipeActionTone = (action: RowMenuAction): "accent" | "highlight" | "destructive" => {
  if (action === "favorite" || action === "unfavorite") return "highlight";
  if (action === "removeFromPlaylist" || (action !== "search" && isDestructiveAction(action)))
    return "destructive";
  return "accent";
};

/**
 * What a swipe direction running [action] shows: the caption on the side it
 * uncovers (its action bar caption) and what TalkBack reads (its full name).
 */
export const swipeActionLabels = (
  action: RowMenuAction,
): { readonly label: string; readonly accessibilityLabel: string } =>
  action === "search"
    ? {
        label: UNAVAILABLE_ENTRY_ACTION_LABELS[action],
        accessibilityLabel: UNAVAILABLE_ENTRY_ACTION_LABELS[action],
      }
    : { label: actionBarLabel(action), accessibilityLabel: ITEM_ACTION_LABELS[action] };

/**
 * What a swipe direction can be set to run, in the order Settings › Swipe
 * actions lists them: a song row's long-press menu entries. Most stand for
 * the entry of their name; `remove` is the row's way out (Remove from
 * Playlist inside a playlist, Delete or Remove from Library elsewhere),
 * `favorite` the star either way (Favorite, or Remove from Favorites on a
 * starred song) and `download` the song's download (Download, or Retry
 * Download after a failure), as the row's menu offers them.
 */
export const SWIPE_CHOICES = [
  "playNext",
  "addToQueue",
  "magicQueue",
  "addToPlaylist",
  "favorite",
  "download",
  "goToAlbum",
  "goToArtist",
  "fixSong",
  "share",
  "remove",
] as const satisfies readonly (RowMenuAction | "remove")[];

/** One of `SWIPE_CHOICES`. */
export type SwipeChoice = (typeof SWIPE_CHOICES)[number];

/** What Settings calls [choice]: its menu entry's name, or Remove. */
export const swipeChoiceLabel = (choice: SwipeChoice): string =>
  choice === "remove" ? "Remove" : ITEM_ACTION_LABELS[choice];

/** How the rows swipe: on or off, and what each direction runs. */
export interface SwipeSettings {
  readonly enabled: boolean;
  readonly right: SwipeChoice;
  readonly left: SwipeChoice;
}

/** Swipes on, right adding to the queue, left removing. */
export const DEFAULT_SWIPE_SETTINGS: SwipeSettings = {
  enabled: true,
  right: "addToQueue",
  left: "remove",
};

const isSwipeChoice = (value: unknown): value is SwipeChoice =>
  (SWIPE_CHOICES as readonly unknown[]).includes(value);

/**
 * The swipe settings as kept on the phone and synced ([stored], null for
 * none): each field this Wave doesn't understand (a choice a newer Wave
 * added) at its default.
 */
export const readSwipeSettings = (stored: string | null): SwipeSettings => {
  const { enabled, right, left } = readStoredRecord(stored);
  return {
    enabled: typeof enabled === "boolean" ? enabled : DEFAULT_SWIPE_SETTINGS.enabled,
    right: isSwipeChoice(right) ? right : DEFAULT_SWIPE_SETTINGS.right,
    left: isSwipeChoice(left) ? left : DEFAULT_SWIPE_SETTINGS.left,
  };
};

/** What to keep for [settings]: null (nothing) at the defaults. */
export const storedSwipeSettings = ({ enabled, right, left }: SwipeSettings): string | null =>
  enabled === DEFAULT_SWIPE_SETTINGS.enabled &&
  right === DEFAULT_SWIPE_SETTINGS.right &&
  left === DEFAULT_SWIPE_SETTINGS.left
    ? null
    : JSON.stringify({ enabled, right, left });

/** The menu entries a choice stands for, the first a row offers winning. */
const CHOICE_ACTIONS: { readonly [C in SwipeChoice]?: readonly RowMenuAction[] } = {
  remove: ["removeFromPlaylist", "delete", "removeFromLibrary"],
  favorite: ["favorite", "unfavorite"],
  download: ["download", "retryDownload"],
};

/**
 * The entry of a row's [menu] (its long-press menu's actions) that [choice]
 * runs, or null when the menu has none: the direction does nothing there.
 */
export const swipeChoiceAction = <A extends RowMenuAction>(
  choice: SwipeChoice,
  menu: readonly A[],
): A | null => {
  for (const action of CHOICE_ACTIONS[choice] ?? [choice]) {
    const offered = menu.find((entry) => entry === action);
    if (offered !== undefined) return offered;
  }
  return null;
};

/** What a row's swipes run: an entry of its menu per direction, null where it doesn't move. */
export interface RowSwipeActions<A extends RowMenuAction = RowMenuAction> {
  readonly right: A | null;
  readonly left: A | null;
}

/**
 * The entry of a song row's long-press [menu] each swipe direction runs, as
 * [settings] set them (Wave's defaults otherwise); both null with swipes off.
 */
export const rowSwipeActions = <A extends RowMenuAction>(
  menu: readonly A[],
  settings: SwipeSettings = DEFAULT_SWIPE_SETTINGS,
): RowSwipeActions<A> =>
  settings.enabled
    ? {
        right: swipeChoiceAction(settings.right, menu),
        left: swipeChoiceAction(settings.left, menu),
      }
    : { right: null, left: null };

/**
 * Whether a swipe direction runs [choice] under [settings]: a row works out
 * what only some choices need (a streamed song's artists, a download's
 * state) only then.
 */
export const swipesChoose = (settings: SwipeSettings, choice: SwipeChoice): boolean =>
  settings.enabled && (settings.right === choice || settings.left === choice);

/**
 * The entry a swipe runs from its row's menu as planned when the swipe runs
 * ([entries]): the one whose action the row showed ([shown]), so a swipe
 * never runs what its row didn't show. None when that entry has left the menu
 * since the row was drawn (a fact it stood on changed): the swipe does nothing.
 */
export const shownSwipeEntry = <E extends { readonly action: RowMenuAction }>(
  entries: readonly E[],
  shown: RowMenuAction,
): E | undefined => entries.find((entry) => entry.action === shown);
