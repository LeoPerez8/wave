/**
 * Now Playing's bottom row: four slots the owner fills (Settings › Layout ›
 * Now Playing), then Queue, fixed on the right.
 */

/** What a slot can hold. */
export type NowPlayingAction =
  | "lyrics"
  | "sleepTimer"
  | "addToPlaylist"
  | "download"
  | "shuffle"
  | "repeat"
  | "share"
  | "songMenu";

/** A slot: an action, or null for None (no button). */
export type NowPlayingSlot = NowPlayingAction | null;

/** The four slots, left to right. */
export type NowPlayingButtons = readonly [
  NowPlayingSlot,
  NowPlayingSlot,
  NowPlayingSlot,
  NowPlayingSlot,
];

/** Every action, in the order a slot's choices list them. */
export const NOW_PLAYING_ACTIONS: readonly NowPlayingAction[] = [
  "lyrics",
  "sleepTimer",
  "addToPlaylist",
  "download",
  "shuffle",
  "repeat",
  "share",
  "songMenu",
];

const isSlot = (value: unknown): value is NowPlayingSlot =>
  value === null || NOW_PLAYING_ACTIONS.some((action) => action === value);

/** Four slots, each an action or None, no action twice. */
const isButtons = (value: unknown): value is NowPlayingButtons => {
  if (!Array.isArray(value) || value.length !== 4 || !value.every(isSlot)) return false;
  const actions = value.filter((slot) => slot !== null);
  return new Set(actions).size === actions.length;
};

/** The row before it could be changed: Lyrics, Sleep timer, Add to Playlist, Download. */
const DEFAULT_BUTTONS: NowPlayingButtons = ["lyrics", "sleepTimer", "addToPlaylist", "download"];

/**
 * The slots a stored value holds. Nothing stored, unreadable JSON or anything
 * but four slots of known actions, each once (a newer Wave's action
 * included), reads as today's row.
 */
export const readNowPlayingButtons = (stored: string | null): NowPlayingButtons => {
  if (stored === null) return DEFAULT_BUTTONS;
  let raw: unknown;
  try {
    raw = JSON.parse(stored);
  } catch {
    return DEFAULT_BUTTONS;
  }
  return isButtons(raw) ? raw : DEFAULT_BUTTONS;
};

/**
 * What to store for [buttons]; `readNowPlayingButtons` reads it back as those
 * slots. Today's row stores as nothing (null).
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
 * brings back today's row.
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
