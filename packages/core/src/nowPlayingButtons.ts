/**
 * Now Playing's bottom row: four slots the owner fills (Settings › Layout ›
 * Now Playing), then Queue, fixed on the right. Related and Song menu have
 * places of their own (the chevron beside the title, the header's button),
 * so no slot holds them.
 */

/** What a slot can hold. */
export type NowPlayingAction =
  "lyrics" | "sleepTimer" | "addToPlaylist" | "download" | "shuffle" | "repeat" | "share";

/** A slot: an action, or null for None (no button). */
export type NowPlayingSlot = NowPlayingAction | null;

/** The four slots, left to right. */
export type NowPlayingButtons = readonly [
  NowPlayingSlot,
  NowPlayingSlot,
  NowPlayingSlot,
  NowPlayingSlot,
];

/**
 * The synced preference the slots are stored under. The default row changed
 * with this key, and the key the slots were kept under before
 * (`settings.nowPlayingButtons`) is no longer read, locally or from the Wave
 * account, so every phone moved to the new default once, edited rows
 * included.
 */
export const NOW_PLAYING_BUTTONS_KEY = "settings.nowPlayingRow";

/** Every action, in the order a slot's choices list them. */
export const NOW_PLAYING_ACTIONS: readonly NowPlayingAction[] = [
  "lyrics",
  "sleepTimer",
  "addToPlaylist",
  "download",
  "shuffle",
  "repeat",
  "share",
];

/**
 * The actions a slot held before they got places of their own. A stored slot
 * holding one (an edited row from before, or one a phone on an older Wave
 * synced) reads as empty.
 */
const RETIRED_ACTIONS: readonly unknown[] = ["related", "songMenu"];

const isSlot = (value: unknown): value is NowPlayingSlot =>
  value === null || NOW_PLAYING_ACTIONS.some((action) => action === value);

/** Four slots, each an action or None, no action twice. */
const isButtons = (value: unknown): value is NowPlayingButtons => {
  if (!Array.isArray(value) || value.length !== 4 || !value.every(isSlot)) return false;
  const actions = value.filter((slot) => slot !== null);
  return new Set(actions).size === actions.length;
};

/**
 * The actions a slot's choices list (its picker in Settings, its long-press
 * card), in order.
 */
export const nowPlayingSlotChoices = (): readonly NowPlayingAction[] => NOW_PLAYING_ACTIONS;

/**
 * The default row: Lyrics, Add to Playlist, Download, Shuffle. Shuffle took
 * Song menu's slot when the song menu moved to the header (docs/spec.md,
 * story 46b).
 */
const DEFAULT_BUTTONS: NowPlayingButtons = ["lyrics", "addToPlaylist", "download", "shuffle"];

/**
 * The slots a stored value holds. A slot holding Related or Song menu reads
 * as empty. Nothing stored, unreadable JSON or anything but four slots of
 * known actions, each once (a newer Wave's action included), reads as the
 * default row.
 */
export const readNowPlayingButtons = (stored: string | null): NowPlayingButtons => {
  if (stored === null) return DEFAULT_BUTTONS;
  let raw: unknown;
  try {
    raw = JSON.parse(stored);
  } catch {
    return DEFAULT_BUTTONS;
  }
  const slots: unknown = Array.isArray(raw)
    ? raw.map((slot: unknown) => (RETIRED_ACTIONS.includes(slot) ? null : slot))
    : raw;
  return isButtons(slots) ? slots : DEFAULT_BUTTONS;
};

/**
 * What to store for [buttons]; `readNowPlayingButtons` reads it back as those
 * slots. The default row stores as nothing (null).
 */
export const storedNowPlayingButtons = (buttons: NowPlayingButtons): string | null =>
  buttons.every((slot, index) => slot === DEFAULT_BUTTONS[index]) ? null : JSON.stringify(buttons);

/**
 * A change made to the slots: one slot (0 to 3) set to an action or None, or
 * Reset to Default.
 */
export type NowPlayingButtonsEdit =
  { readonly slot: number; readonly action: NowPlayingSlot } | "reset";

/**
 * [buttons] after [edit]. An action another slot holds swaps places with what
 * the edited slot held (None included), so no action shows twice. Reset
 * brings back the default row.
 */
export const editNowPlayingButtons = (
  buttons: NowPlayingButtons,
  edit: NowPlayingButtonsEdit,
): NowPlayingButtons => {
  if (edit === "reset") return DEFAULT_BUTTONS;
  const previous = buttons[edit.slot];
  if (previous === undefined) return buttons;
  const [a, b, c, d] = buttons.map((slot, index) => {
    if (index === edit.slot) return edit.action;
    return slot !== null && slot === edit.action ? previous : slot;
  });
  return [a ?? null, b ?? null, c ?? null, d ?? null];
};

/**
 * What's on, as the slots see it: nothing, an unsearched entry while its
 * search runs, or a song.
 */
export type NowPlayingSlotSong = "nothing" | "unsearched" | "song";

/** The actions that need a song on to show: with nothing playing their slots stay empty. */
const NEEDS_SONG: ReadonlySet<NowPlayingAction> = new Set(["addToPlaylist", "download", "share"]);

/**
 * How slot [action]'s button shows with [song] on: hidden (its slot stays
 * empty) or on.
 */
export const nowPlayingSlotShow = (
  action: NowPlayingAction,
  song: NowPlayingSlotSong,
): "hidden" | "on" => (song === "nothing" && NEEDS_SONG.has(action) ? "hidden" : "on");

/**
 * How the song menu button (⋯) in Now Playing's header shows with [song] on:
 * hidden with nothing playing, off (disabled) while an unsearched entry's
 * search runs, since the song has no card yet, else on.
 */
export const nowPlayingSongMenuShow = (song: NowPlayingSlotSong): "hidden" | "off" | "on" =>
  song === "nothing" ? "hidden" : song === "unsearched" ? "off" : "on";

/**
 * Whether the chevron beside the title, which opens Related, shows: with
 * something on and YouTube Music on ([ytMusic]), which Related reads.
 */
export const nowPlayingRelatedChevronShown = (
  song: NowPlayingSlotSong,
  ytMusic: boolean,
): boolean => ytMusic && song !== "nothing";

/** The slot pickers' routes, `1` to `4`, left to right. */
const SLOT_ROUTES = ["1", "2", "3", "4"];

/**
 * The slot (0 to 3) a slot picker's route param names, `1` to `4`; null for
 * anything else, so an old or mistyped link edits no slot.
 */
export const readNowPlayingSlotRoute = (param: string | string[] | undefined): number | null => {
  const index = typeof param === "string" ? SLOT_ROUTES.indexOf(param) : -1;
  return index === -1 ? null : index;
};
