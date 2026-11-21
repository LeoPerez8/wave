/**
 * Now Playing's seven slots, which the owner fills (on the player in edit mode, and in
 * Settings › Layout's Now Playing editor): five footer slots under the transport,
 * then one on each side of it, left of Previous and right of Next. Related
 * and Song menu have places of their own (the chevron beside the title, the
 * header's button), so no slot holds them. Dislike, Magic Queue, Go to
 * Artist and Go to Album are offered, in no slot by default.
 */

/** What a slot can hold. */
export type NowPlayingAction =
  | "lyrics"
  | "queue"
  | "sleepTimer"
  | "addToPlaylist"
  | "download"
  | "shuffle"
  | "repeat"
  | "share"
  | "dislike"
  | "magicQueue"
  | "goToArtist"
  | "goToAlbum";

/** A slot: an action, or null for None (no button). */
export type NowPlayingSlot = NowPlayingAction | null;

/** The seven slots: footer 1 to 5, left to right, then the transport's left and right. */
export type NowPlayingButtons = readonly [
  NowPlayingSlot,
  NowPlayingSlot,
  NowPlayingSlot,
  NowPlayingSlot,
  NowPlayingSlot,
  NowPlayingSlot,
  NowPlayingSlot,
];

/** How many of the slots are the footer's: slots 0 to 4. */
export const NOW_PLAYING_FOOTER_SLOTS = 5;

/** The transport's slots: left of Previous and right of Next. */
export const NOW_PLAYING_TRANSPORT_SLOTS = { left: 5, right: 6 } as const;

/** The synced preference the seven slots are stored under. */
export const NOW_PLAYING_BUTTONS_KEY = "settings.nowPlayingSlots";

/**
 * The synced preference the row of four slots was stored under, before there
 * were seven. It is read while nothing is stored under the new key, to keep
 * an edited row (`readNowPlayingButtons`), and never written, so a phone on
 * an older Wave keeps its row.
 */
export const NOW_PLAYING_PREVIOUS_ROW_KEY = "settings.nowPlayingRow";

/** Every action, in the order a slot's choices list them. */
export const NOW_PLAYING_ACTIONS: readonly NowPlayingAction[] = [
  "lyrics",
  "queue",
  "sleepTimer",
  "addToPlaylist",
  "download",
  "shuffle",
  "repeat",
  "share",
  "dislike",
  "magicQueue",
  "goToArtist",
  "goToAlbum",
];

const isAction = (value: unknown): value is NowPlayingAction =>
  NOW_PLAYING_ACTIONS.some((action) => action === value);

const isSlot = (value: unknown): value is NowPlayingSlot => value === null || isAction(value);

/** [count] slots, each an action or None, no action twice. */
const isSlots = (value: unknown, count: number): value is readonly NowPlayingSlot[] => {
  if (!Array.isArray(value) || value.length !== count || !value.every(isSlot)) return false;
  const actions = value.filter((slot) => slot !== null);
  return new Set(actions).size === actions.length;
};

const isButtons = (value: unknown): value is NowPlayingButtons => isSlots(value, 7);

/**
 * [value] with each slot holding a name this Wave doesn't know (a newer
 * Wave's action, or one no slot holds any more) read as empty, so the slot
 * shows nothing and the others read as saved; anything else as it is.
 */
const withUnknownEmpty = (value: unknown): unknown =>
  Array.isArray(value)
    ? value.map((slot: unknown) => (typeof slot === "string" && !isAction(slot) ? null : slot))
    : value;

/** What [stored] holds as JSON; undefined when it isn't JSON. */
const parsed = (stored: string): unknown => {
  try {
    return JSON.parse(stored);
  } catch {
    return undefined;
  }
};

/**
 * The actions a slot's choices list (its picker in Settings, its card in
 * edit mode), in order; both put None before them.
 */
export const nowPlayingSlotChoices = (): readonly NowPlayingAction[] => NOW_PLAYING_ACTIONS;

/** Where a slot sits, as a choice's caption names it: the footer, or beside Previous or Next. */
export type NowPlayingSlotPlace = "footer" | "previous" | "next";

/**
 * The caption [action] shows in slot [slot]'s choices: the place of the
 * other slot that holds it (picking it swaps the two), or null for the
 * slot's own action, an action no slot holds, and None.
 */
export const nowPlayingSlotChoiceHolder = (
  buttons: readonly NowPlayingSlot[],
  slot: number,
  action: NowPlayingSlot,
): NowPlayingSlotPlace | null => {
  const holder = action === null ? -1 : buttons.indexOf(action);
  if (holder === -1 || holder === slot) return null;
  if (holder < NOW_PLAYING_FOOTER_SLOTS) return "footer";
  return holder === NOW_PLAYING_TRANSPORT_SLOTS.left ? "previous" : "next";
};

/**
 * The default: Lyrics, Add to Playlist, Download, Shuffle and Repeat in the
 * footer, and both transport slots empty.
 */
const DEFAULT_BUTTONS: NowPlayingButtons = [
  "lyrics",
  "addToPlaylist",
  "download",
  "shuffle",
  "repeat",
  null,
  null,
];

/** Whether [buttons] are the default, which is what turns Reset to Default off. */
export const nowPlayingButtonsAreDefault = (buttons: NowPlayingButtons): boolean =>
  buttons.every((slot, index) => slot === DEFAULT_BUTTONS[index]);

/**
 * The actions a slot of the row from before could hold and no slot holds
 * now: they read as empty.
 */
const RETIRED_ACTIONS: readonly unknown[] = ["related", "songMenu"];

/**
 * The seven slots an edited row from before ([previousRow], as stored under
 * `NOW_PLAYING_PREVIOUS_ROW_KEY`) becomes: its four slots in footer 1 to 4,
 * Related and Song menu as empty, then Queue, which was a fixed button on
 * their right, and empty transport slots. Null when nothing is stored there
 * or it isn't four slots of that row's actions, each once.
 */
const convertedRow = (previousRow: string | null): NowPlayingButtons | null => {
  if (previousRow === null) return null;
  const raw = parsed(previousRow);
  if (!Array.isArray(raw)) return null;
  const slots: unknown[] = raw.map((slot: unknown) =>
    RETIRED_ACTIONS.includes(slot) ? null : slot,
  );
  // Queue was no slot's action then, so a row holding it isn't one Wave stored.
  if (!isSlots(slots, 4) || slots.includes("queue")) return null;
  const [a, b, c, d] = slots;
  return [a ?? null, b ?? null, c ?? null, d ?? null, "queue", null, null];
};

/**
 * The slots a stored value holds. With nothing stored, an edited row from
 * before ([previousRow]) is kept, converted to seven slots; with none, the
 * default shows. A slot holding an action this Wave doesn't know (a newer
 * Wave's) reads as empty. Unreadable JSON or anything but seven slots, each
 * action once, reads as the default.
 */
export const readNowPlayingButtons = (
  stored: string | null,
  previousRow: string | null = null,
): NowPlayingButtons => {
  if (stored === null) return convertedRow(previousRow) ?? DEFAULT_BUTTONS;
  const slots = withUnknownEmpty(parsed(stored));
  return isButtons(slots) ? slots : DEFAULT_BUTTONS;
};

/**
 * What to store for [buttons]; `readNowPlayingButtons` reads it back as those
 * slots. The default stores as nothing (null), unless an edited row from
 * before ([previousRow]) would be read in its place: then the default is
 * stored as itself, so Reset to Default holds.
 */
export const storedNowPlayingButtons = (
  buttons: NowPlayingButtons,
  previousRow: string | null = null,
): string | null =>
  nowPlayingButtonsAreDefault(buttons) && convertedRow(previousRow) === null
    ? null
    : JSON.stringify(buttons);

/**
 * A change made to the slots: one slot (0 to 6) set to an action or None, or
 * Reset to Default.
 */
export type NowPlayingButtonsEdit =
  { readonly slot: number; readonly action: NowPlayingSlot } | "reset";

/**
 * [buttons] after [edit]. An action another slot holds, in the footer or
 * beside the transport, swaps places with what the edited slot held (None
 * included), so no action shows twice. Reset brings back the default.
 */
export const editNowPlayingButtons = (
  buttons: NowPlayingButtons,
  edit: NowPlayingButtonsEdit,
): NowPlayingButtons => {
  if (edit === "reset") return DEFAULT_BUTTONS;
  const previous = buttons[edit.slot];
  if (previous === undefined) return buttons;
  const [a, b, c, d, e, f, g] = buttons.map((slot, index) => {
    if (index === edit.slot) return edit.action;
    return slot !== null && slot === edit.action ? previous : slot;
  });
  return [a ?? null, b ?? null, c ?? null, d ?? null, e ?? null, f ?? null, g ?? null];
};

/**
 * Move the button from slot [from] to [to]. A filled destination swaps with
 * it; an empty one leaves the source empty. Invalid slots, an empty source,
 * or the same slot leave the arrangement alone.
 */
export const moveNowPlayingButton = (
  buttons: NowPlayingButtons,
  from: number,
  to: number,
): NowPlayingButtons => {
  const action = buttons[from];
  const destination = buttons[to];
  if (
    from === to ||
    from < 0 ||
    from >= buttons.length ||
    to < 0 ||
    to >= buttons.length ||
    action == null
  )
    return buttons;
  const moved = [...buttons] as [
    NowPlayingSlot,
    NowPlayingSlot,
    NowPlayingSlot,
    NowPlayingSlot,
    NowPlayingSlot,
    NowPlayingSlot,
    NowPlayingSlot,
  ];
  moved[to] = action;
  moved[from] = destination ?? null;
  return moved;
};

/**
 * What's on, as the slots see it: nothing, an unsearched entry while its
 * search runs, or a song.
 */
export type NowPlayingSlotSong = "nothing" | "unsearched" | "song";

/**
 * The actions that run the entry of the same name on the playing song's card
 * (its menu, Core's `itemActions` or `ytSongActions` with `playing` set).
 */
const SONG_MENU_ACTIONS: ReadonlySet<NowPlayingAction> = new Set([
  "magicQueue",
  "goToArtist",
  "goToAlbum",
]);

/**
 * The actions that need a song on to show: with nothing playing their slots
 * stay empty. Queue is one, its screen being the playing song's.
 */
const NEEDS_SONG: ReadonlySet<NowPlayingAction> = new Set([
  "queue",
  "addToPlaylist",
  "download",
  "share",
  "dislike",
  ...SONG_MENU_ACTIONS,
]);

/**
 * How slot [action]'s button shows with [song] on: hidden (its slot stays
 * empty), off (it shows disabled) or on. Dislike is off while an unsearched
 * entry's search runs, since there is no song yet to keep a dislike under.
 * Magic Queue, Go to Artist and Go to Album run the playing song's card's
 * entry of the same name, so each is on only while that card offers it
 * ([menu], the card's actions): off while an unsearched entry's search runs,
 * which has no card yet, and off for a song the entry doesn't apply to (Go to
 * Album on a song without an album, Magic Queue with YT Music off on a
 * streamed song).
 */
export const nowPlayingSlotShow = (
  action: NowPlayingAction,
  song: NowPlayingSlotSong,
  menu: readonly string[] = [],
): "hidden" | "off" | "on" => {
  if (song === "nothing") return NEEDS_SONG.has(action) ? "hidden" : "on";
  if (SONG_MENU_ACTIONS.has(action)) return song === "song" && menu.includes(action) ? "on" : "off";
  return song === "unsearched" && action === "dislike" ? "off" : "on";
};

/**
 * Whether slot [action] runs the playing song's card's entry of the same name
 * (Magic Queue, Go to Artist, Go to Album), which `nowPlayingSlotShow` needs
 * the card's actions for.
 */
export const nowPlayingSlotRunsSongMenu = (action: NowPlayingAction): boolean =>
  SONG_MENU_ACTIONS.has(action);

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
