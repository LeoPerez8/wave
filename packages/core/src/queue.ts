/**
 * The queue engine: what plays now and what plays next.
 *
 * A pure state + command reducer. Playback starts from a context (an album,
 * the Songs list, a playlist…) at a given track, and the rest of that context
 * is queued around it. Play Next / Add to Queue entries sit between context
 * entries. The app pushes the resulting ordered list to the native player.
 */

import { libraryTrackIds } from "./ytQueue.ts";

export type RepeatMode = "off" | "all" | "one";

/** Where the context entries came from, e.g. `{ kind: "album", id: "12" }`. */
export interface QueueContext {
  readonly kind: string;
  readonly id: string | null;
}

export interface QueueEntry {
  /** Unique across every entry this queue has ever held; the native player's media id. */
  readonly key: string;
  readonly trackId: string;
  /** Position in the original context order, or null for Play Next / Add to Queue entries. */
  readonly contextIndex: number | null;
}

export interface QueueState {
  readonly context: QueueContext | null;
  /** Every entry in play order: history, the current entry, then Up Next. */
  readonly entries: readonly QueueEntry[];
  /** The current entry, or -1 when the queue is empty. */
  readonly index: number;
  readonly shuffle: boolean;
  readonly repeat: RepeatMode;
  /** The counter the next entry key is made from. */
  readonly nextKey: number;
}

export type QueueCommand =
  | {
      readonly type: "play";
      readonly trackIds: readonly string[];
      /** The tapped track; omitted to start at the top (or anywhere, when shuffling). */
      readonly startIndex?: number | undefined;
      readonly context: QueueContext;
      /** Overrides the current shuffle setting (an album's Shuffle button). */
      readonly shuffle?: boolean | undefined;
    }
  | { readonly type: "next" }
  | { readonly type: "previous"; readonly positionMs: number }
  | { readonly type: "trackEnded" }
  | { readonly type: "jumpTo"; readonly key: string }
  /** The native player moved to this entry on its own: auto-advance, notification or Bluetooth. */
  | { readonly type: "playerMoved"; readonly key: string }
  | { readonly type: "setShuffle"; readonly on: boolean }
  /**
   * Shuffles again by the kind of shuffle given (a kind chosen on the shuffle
   * card), turning shuffle on if it's off: Up Next reorders as turning
   * shuffle on would.
   */
  | { readonly type: "reshuffle" }
  | { readonly type: "setRepeat"; readonly mode: RepeatMode }
  | { readonly type: "playNext"; readonly trackIds: readonly string[] }
  | { readonly type: "addToQueue"; readonly trackIds: readonly string[] }
  /**
   * More of the playing context: a Magic Queue's batch. The songs join the
   * end of the queue as context entries, after everything lined up, so they
   * aren't taken for songs lined up by hand. Nothing joins an empty queue.
   */
  | { readonly type: "append"; readonly trackIds: readonly string[] }
  /**
   * More from this artist: the next `MORE_FROM_ARTIST` songs of the artist's
   * [ranking] (Core's `artistRanking`) go right after the current track.
   */
  | { readonly type: "moreFromArtist"; readonly ranking: readonly string[] }
  /** Moves an Up Next entry beside its new neighbours (see `UpNextMove`, made by `upNextMove`). */
  | ({ readonly type: "move" } & UpNextMove)
  | { readonly type: "remove"; readonly key: string }
  /** These tracks left the library (their files were deleted): every entry of theirs goes. */
  | { readonly type: "removeTracks"; readonly trackIds: readonly string[] }
  /**
   * An unsearched song (by its id) was searched: found, every entry of it
   * becomes [becomes] (the YT Music song's id) in its place, keeping its key;
   * not found (null), every entry of it goes, as `removeTracks` takes them.
   */
  | { readonly type: "settled"; readonly trackId: string; readonly becomes: string | null };

/**
 * What the app should do to playback besides syncing the list:
 * - `keep`: nothing; the player keeps playing or paused as it was.
 * - `play`: start playing the current entry.
 * - `restart`: seek the current entry back to its start.
 * - `stop`: the queue ran out (repeat off); pause at the start of the current entry.
 */
export type QueuePlayback = "keep" | "play" | "restart" | "stop";

export interface QueueResult {
  readonly state: QueueState;
  readonly playback: QueuePlayback;
}

export const EMPTY_QUEUE: QueueState = {
  context: null,
  entries: [],
  index: -1,
  shuffle: false,
  repeat: "off",
  nextKey: 1,
};

/** Builds entries with fresh keys, returning them with the advanced key counter. */
const makeEntries = (
  trackIds: readonly string[],
  nextKey: number,
  contextIndex: (i: number) => number | null,
): { entries: QueueEntry[]; nextKey: number } => ({
  entries: trackIds.map((trackId, i) => ({
    key: String(nextKey + i),
    trackId,
    contextIndex: contextIndex(i),
  })),
  nextKey: nextKey + trackIds.length,
});

const result = (state: QueueState, playback: QueuePlayback = "keep"): QueueResult => ({
  state,
  playback,
});

/**
 * The songs of [command]'s list that play, those [passOver] leaves out
 * gone, and where the tapped one is among them: a tapped song passed over
 * gives way to the next one that plays, else the last before it.
 */
const playedTracks = (
  command: Extract<QueueCommand, { type: "play" }>,
  passOver: PassOver,
): { trackIds: string[]; startIndex: number | undefined } => {
  const tapped = command.startIndex;
  const trackIds: string[] = [];
  let startIndex: number | undefined;
  for (const [at, trackId] of command.trackIds.entries()) {
    if (passOver(trackId)) continue;
    if (tapped !== undefined && startIndex === undefined && at >= tapped) {
      startIndex = trackIds.length;
    }
    trackIds.push(trackId);
  }
  if (tapped !== undefined && startIndex === undefined) {
    startIndex = Math.max(0, trackIds.length - 1);
  }
  return { trackIds, startIndex };
};

const play = (
  state: QueueState,
  command: Extract<QueueCommand, { type: "play" }>,
  random: () => number,
  kind: Shuffle,
  passOver: PassOver,
): QueueResult => {
  if (!playReplacesQueue(command, passOver)) return result(state);
  const { trackIds, startIndex: tapped } = playedTracks(command, passOver);
  const { entries, nextKey } = makeEntries(trackIds, state.nextKey, (i) => i);
  if (entries.length === 0) return result({ ...EMPTY_QUEUE, repeat: state.repeat, nextKey });
  const shuffle = command.shuffle ?? state.shuffle;
  // Smart Shuffle with no song tapped (a Shuffle button) orders the whole list, first song included.
  if (shuffle && tapped === undefined && kind.kind === "smart") {
    const order = shuffleEntries(entries, random, kind);
    return result(
      { ...state, context: command.context, entries: order, index: 0, shuffle: true, nextKey },
      "play",
    );
  }
  const startIndex = tapped ?? (shuffle ? Math.floor(random() * entries.length) : 0);
  const index = Math.max(0, Math.min(Math.trunc(startIndex), entries.length - 1));
  const started: QueueState = {
    ...state,
    context: command.context,
    entries,
    index,
    shuffle: false,
    nextKey,
  };
  return result(shuffle ? shuffleOn(started, random, kind) : started, "play");
};

/** A shuffled copy (Fisher–Yates): every order equally likely. */
const shuffled = <A>(items: readonly A[], random: () => number): A[] => {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [copy[i], copy[j]] = [copy[j]!, copy[i]!];
  }
  return copy;
};

/**
 * Smart Shuffle's order: the entries ranked by their track's counted plays,
 * the top half of the played ones (most played) spread evenly among the rest
 * (less played, never-played songs included), each side in random order. The
 * most played land at evenly spaced places from a random offset, so in every
 * stretch from the start each side holds its share, give or take one song.
 */
const smartShuffled = (
  entries: readonly QueueEntry[],
  random: () => number,
  plays: ReadonlyMap<string, number>,
): QueueEntry[] => {
  const playsOf = (entry: QueueEntry): number => plays.get(entry.trackId) ?? 0;
  // Shuffled first, so songs with as many plays as each other split at random.
  const ranked = shuffled(entries, random)
    .map((entry, order) => ({ entry, order }))
    // oxlint-disable-next-line unicorn/no-array-sort -- sorts a fresh copy; Hermes lacks toSorted
    .sort((a, b) => playsOf(b.entry) - playsOf(a.entry) || a.order - b.order)
    .map(({ entry }) => entry);
  const played = ranked.filter((entry) => playsOf(entry) > 0).length;
  const mostCount = Math.min(played, Math.floor(ranked.length / 2));
  const most = shuffled(ranked.slice(0, mostCount), random);
  const less = shuffled(ranked.slice(mostCount), random);
  if (most.length === 0) return less;
  const offset = random();
  const places = new Set(
    most.map((_, i) => Math.floor(((i + offset) * ranked.length) / most.length)),
  );
  let nextMost = 0;
  let nextLess = 0;
  return ranked.map((_, at) => (places.has(at) ? most[nextMost++]! : less[nextLess++]!));
};

/**
 * Which kind of shuffle reorders the queue when shuffle turns on:
 * - `real`: every order is as likely (Fisher–Yates).
 * - `smart`: the most played songs (by all-time counted [plays], per track id;
 *   a track missing from it has never been played) interleaved with the less
 *   played ones, so neither side bunches up.
 */
export type Shuffle =
  | { readonly kind: "real" }
  | { readonly kind: "smart"; readonly plays: ReadonlyMap<string, number> };

export const REAL_SHUFFLE: Shuffle = { kind: "real" };

/**
 * Which songs the queue passes over, by track id: songs that don't play now
 * (explicit ones while Don't play explicit is on, Core's `explicitPassOver`).
 * A play, Play Next, Add to Queue or More from this artist leaves them out,
 * and an unsearched song found as one goes as one not found does.
 */
export type PassOver = (trackId: string) => boolean;

/** Passes over nothing: every song plays. */
const playsAll: PassOver = () => false;

/**
 * Whether [command] replaces the queue: a play does, unless [passOver]
 * passes every one of its songs over, when nothing plays instead and the
 * queue stays (a play of no songs at all empties it). So the app knows
 * whether to forget the old queue's tracks.
 */
export const playReplacesQueue = (command: QueueCommand, passOver: PassOver = playsAll): boolean =>
  command.type === "play" &&
  (command.trackIds.length === 0 || command.trackIds.some((trackId) => !passOver(trackId)));

/** The songs of [trackIds] that play, in order. */
const playing = (trackIds: readonly string[], passOver: PassOver): readonly string[] =>
  trackIds.filter((trackId) => !passOver(trackId));

/** The kind of shuffle the owner chose on the shuffle card. */
export type ShuffleKind = Shuffle["kind"];

/** The saved shuffle kind (what `ShuffleKind` stores as); Real Shuffle unless Smart was chosen. */
export const readShuffleKind = (stored: string | null): ShuffleKind =>
  stored === "smart" ? "smart" : "real";

/**
 * Whether [command] shuffles [state]'s queue, and so uses the kind of shuffle
 * `reduceQueue` is given: the app reads play counts for Smart Shuffle only then.
 */
export const shufflesQueue = (state: QueueState, command: QueueCommand): boolean => {
  switch (command.type) {
    case "play":
      return command.shuffle ?? state.shuffle;
    case "setShuffle":
      return command.on && !state.shuffle;
    case "reshuffle":
      return true;
    default:
      return false;
  }
};

/**
 * The Library tracks [command] orders when it shuffles [state]'s queue, each
 * once: a play's songs, or the queue's. Smart Shuffle needs their plays and no
 * others; a command that doesn't shuffle needs none.
 */
export const shuffledTrackIds = (state: QueueState, command: QueueCommand): number[] => {
  if (!shufflesQueue(state, command)) return [];
  return libraryTrackIds(
    command.type === "play" ? command.trackIds : state.entries.map((entry) => entry.trackId),
  );
};

/** [entries] in the order [shuffle] gives them. */
const shuffleEntries = (
  entries: readonly QueueEntry[],
  random: () => number,
  shuffle: Shuffle,
): QueueEntry[] =>
  shuffle.kind === "smart"
    ? smartShuffled(entries, random, shuffle.plays)
    : shuffled(entries, random);

/** Queued entries after the current one; they stay next whenever the order changes. */
const upcomingQueued = (state: QueueState): QueueEntry[] =>
  state.entries.slice(state.index + 1).filter(isQueued);

/**
 * The current entry goes first, lined-up entries stay right after it, and every
 * other context entry (played or not) is shuffled after them. Lined-up entries
 * that already played are dropped.
 */
const shuffleOn = (state: QueueState, random: () => number, shuffle: Shuffle): QueueState => {
  const current = currentEntry(state);
  if (current === null) return { ...state, shuffle: true };
  const others = state.entries.filter((entry) => entry !== current && !isQueued(entry));
  return {
    ...state,
    entries: [current, ...upcomingQueued(state), ...shuffleEntries(others, random, shuffle)],
    index: 0,
    shuffle: true,
  };
};

/**
 * Restores the context order (entries removed meanwhile stay removed) around
 * the current entry, with lined-up entries right after it. A lined-up current
 * entry stays after the context entry that played before it.
 */
const shuffleOff = (state: QueueState): QueueState => {
  const current = currentEntry(state);
  if (current === null) return { ...state, shuffle: false };
  const context = state.entries
    .filter((entry) => !isQueued(entry))
    // oxlint-disable-next-line unicorn/no-array-sort -- sorts a fresh copy; Hermes lacks toSorted
    .sort((a, b) => a.contextIndex! - b.contextIndex!);
  let split: number;
  if (isQueued(current)) {
    let before: QueueEntry | undefined;
    for (let i = state.index - 1; i >= 0 && before === undefined; i -= 1) {
      if (!isQueued(state.entries[i]!)) before = state.entries[i];
    }
    split = before === undefined ? 0 : context.indexOf(before) + 1;
  } else {
    split = context.indexOf(current);
  }
  const head = context.slice(0, split);
  const tail = context.slice(split).filter((entry) => entry !== current);
  return {
    ...state,
    entries: [...head, current, ...upcomingQueued(state), ...tail],
    index: head.length,
    shuffle: false,
  };
};

const setShuffle = (
  state: QueueState,
  on: boolean,
  random: () => number,
  shuffle: Shuffle,
): QueueResult => {
  if (on === state.shuffle) return result(state);
  return result(on ? shuffleOn(state, random, shuffle) : shuffleOff(state));
};

/** Moves to the next entry; past the end it stops. */
const advance = (state: QueueState): QueueResult => {
  if (state.index < 0) return result(state);
  if (state.index + 1 < state.entries.length) return result({ ...state, index: state.index + 1 });
  if (state.repeat === "all") return result(wrapToStart(state));
  return result(state, "stop");
};

/** Repeat all starts over; lined-up entries have all played by then and are dropped. */
const wrapToStart = (state: QueueState): QueueState => {
  const context = state.entries.filter((entry) => !isQueued(entry));
  return { ...state, entries: context.length > 0 ? context : state.entries, index: 0 };
};

const NEXT_REPEAT: Record<RepeatMode, RepeatMode> = { off: "all", all: "one", one: "off" };

/** What the repeat button switches to: off → all → one → off, like Apple Music's. */
export const nextRepeatMode = (mode: RepeatMode): RepeatMode => NEXT_REPEAT[mode];

/** Past this much of a track, previous restarts it instead (as Apple Music and Media3 do). */
export const RESTART_THRESHOLD_MS = 3000;

/** Restarts the current entry after 3 s, otherwise goes to the previous one. */
const back = (state: QueueState, positionMs: number): QueueResult => {
  if (state.index < 0) return result(state);
  if (positionMs > RESTART_THRESHOLD_MS) return result(state, "restart");
  if (state.index > 0) return result({ ...state, index: state.index - 1 });
  if (state.repeat === "all") return result({ ...state, index: state.entries.length - 1 });
  return result(state, "restart");
};

const isQueued = (entry: QueueEntry): boolean => entry.contextIndex === null;

/**
 * Inserts tracks as queued entries: right after the current entry (Play Next)
 * or after the queued entries that already follow it (Add to Queue).
 */
const enqueue = (
  state: QueueState,
  trackIds: readonly string[],
  where: "next" | "last",
): QueueResult => {
  if (trackIds.length === 0) return result(state);
  const { entries: added, nextKey } = makeEntries(trackIds, state.nextKey, () => null);
  if (state.index < 0) return result({ ...state, entries: added, index: 0, nextKey }, "play");
  let at = state.index + 1;
  if (where === "last") {
    while (at < state.entries.length && isQueued(state.entries[at]!)) at += 1;
  }
  const entries = [...state.entries.slice(0, at), ...added, ...state.entries.slice(at)];
  return result({ ...state, entries, nextKey });
};

/** Adds [trackIds] at the end of the queue as context entries, after the context's last. */
const append = (state: QueueState, trackIds: readonly string[]): QueueResult => {
  if (state.index < 0 || trackIds.length === 0) return result(state);
  const last = state.entries.reduce((most, entry) => Math.max(most, entry.contextIndex ?? -1), -1);
  const { entries: added, nextKey } = makeEntries(trackIds, state.nextKey, (i) => last + 1 + i);
  return result({ ...state, entries: [...state.entries, ...added], nextKey });
};

/** How many songs a tap on More from this artist adds. */
export const MORE_FROM_ARTIST = 3;

/**
 * Adds the first `MORE_FROM_ARTIST` songs of the artist's [ranking] that
 * aren't queued: not playing, not in Up Next, and not lined up earlier and
 * played since (a context entry behind the current one can come back). They go
 * right after the current track, after the artist's songs lined up there
 * already, which is where the earlier taps put theirs.
 */
const moreFromArtist = (state: QueueState, ranking: readonly string[]): QueueResult => {
  if (state.index < 0) return result(state);
  const queued = new Set(
    state.entries
      .filter((entry, i) => i >= state.index || isQueued(entry))
      .map((entry) => entry.trackId),
  );
  const trackIds = ranking.filter((trackId) => !queued.has(trackId)).slice(0, MORE_FROM_ARTIST);
  if (trackIds.length === 0) return result(state);
  const artist = new Set(ranking);
  // Past the artist's songs lined up right after the current track.
  const { entries: added, nextKey } = makeEntries(trackIds, state.nextKey, () => null);
  let at = state.index + 1;
  while (at < state.entries.length) {
    const entry = state.entries[at]!;
    if (!isQueued(entry) || !artist.has(entry.trackId)) break;
    at += 1;
  }
  const entries = [...state.entries.slice(0, at), ...added, ...state.entries.slice(at)];
  return result({ ...state, entries, nextKey });
};

const indexOfKey = (state: QueueState, key: string): number =>
  state.entries.findIndex((entry) => entry.key === key);

/** The state with the entry for `key` current; unchanged when the key is unknown or current. */
const select = (state: QueueState, key: string): QueueState => {
  const index = indexOfKey(state, key);
  return index < 0 || index === state.index ? state : { ...state, index };
};

/** Plays the entry for `key`, e.g. tapped in Up Next. */
const jumpTo = (state: QueueState, key: string): QueueResult =>
  indexOfKey(state, key) < 0 ? result(state) : result(select(state, key), "play");

/** Follows the native player; moving forward (including a repeat-all wrap) is an ordinary advance. */
const playerMoved = (state: QueueState, key: string): QueueResult => {
  if (currentEntry(state)?.key === key) return result(state);
  const advanced = advance(state).state;
  return result(currentEntry(advanced)?.key === key ? advanced : select(state, key));
};

/** Moves an Up Next entry to another Up Next position (clamped). */
const move = (state: QueueState, { key, after, before }: UpNextMove): QueueResult => {
  const from = indexOfKey(state, key);
  if (from <= state.index) return result(state);
  const entries = [...state.entries];
  const [entry] = entries.splice(from, 1);
  const upcoming = (anchor: string | null): number => {
    if (anchor === null) return -1;
    const at = entries.findIndex((other) => other.key === anchor);
    return at > state.index ? at : -1;
  };
  const afterAt = upcoming(after);
  const beforeAt = upcoming(before);
  const to = afterAt >= 0 ? afterAt + 1 : beforeAt >= 0 ? beforeAt : state.index + 1;
  if (to === from) return result(state);
  entries.splice(to, 0, entry!);
  return result({ ...state, entries });
};

/** Removes any entry but the current one. */
const remove = (state: QueueState, key: string): QueueResult => {
  const at = indexOfKey(state, key);
  if (at < 0 || at === state.index) return result(state);
  const entries = state.entries.filter((_, i) => i !== at);
  return result({ ...state, entries, index: at < state.index ? state.index - 1 : state.index });
};

/**
 * Drops every entry of the tracks. If the current one goes, playback moves on
 * to the next entry left (wrapping with repeat all); with nothing after it, it
 * stops on the entry before.
 */
const removeTracks = (state: QueueState, trackIds: readonly string[]): QueueResult => {
  const gone = new Set(trackIds);
  if (!state.entries.some((entry) => gone.has(entry.trackId))) return result(state);
  const entries = state.entries.filter((entry) => !gone.has(entry.trackId));
  if (entries.length === 0) return result({ ...state, entries, index: -1 });
  const current = currentEntry(state);
  if (current !== null && !gone.has(current.trackId)) {
    return result({ ...state, entries, index: entries.indexOf(current) });
  }
  // The entries before the current one that stay: the next one left takes its place.
  const before = state.entries.slice(0, state.index).filter((entry) => !gone.has(entry.trackId));
  if (before.length < entries.length) return result({ ...state, entries, index: before.length });
  if (state.repeat === "all") return result(wrapToStart({ ...state, entries, index: 0 }));
  return result({ ...state, entries, index: entries.length - 1 }, "stop");
};

/**
 * An unsearched song's entries once searched: each becomes [becomes], or
 * they go when it wasn't found (null) or was found as a song passed over.
 */
const settled = (
  state: QueueState,
  trackId: string,
  becomes: string | null,
  passOver: PassOver,
): QueueResult => {
  if (becomes === null || passOver(becomes)) return removeTracks(state, [trackId]);
  if (!state.entries.some((entry) => entry.trackId === trackId)) return result(state);
  const entries = state.entries.map((entry) =>
    entry.trackId === trackId ? { ...entry, trackId: becomes } : entry,
  );
  return result({ ...state, entries });
};

/**
 * Applies one command. `random` returns numbers in [0, 1); pass a seeded one
 * in tests. [shuffle] is the kind of shuffle a command that shuffles uses,
 * and [passOver] says which songs don't play (`PassOver`).
 */
export const reduceQueue = (
  state: QueueState,
  command: QueueCommand,
  random: () => number = Math.random,
  shuffle: Shuffle = REAL_SHUFFLE,
  passOver: PassOver = playsAll,
): QueueResult => {
  switch (command.type) {
    case "play":
      return play(state, command, random, shuffle, passOver);
    case "setShuffle":
      return setShuffle(state, command.on, random, shuffle);
    case "reshuffle":
      return result(shuffleOn(state, random, shuffle));
    case "next":
      return advance(state);
    case "trackEnded":
      return state.repeat === "one" ? result(state) : advance(state);
    case "previous":
      return back(state, command.positionMs);
    case "setRepeat":
      return result({ ...state, repeat: command.mode });
    case "playNext":
      return enqueue(state, playing(command.trackIds, passOver), "next");
    case "addToQueue":
      return enqueue(state, playing(command.trackIds, passOver), "last");
    case "append":
      return append(state, playing(command.trackIds, passOver));
    case "moreFromArtist":
      return moreFromArtist(state, playing(command.ranking, passOver));
    case "jumpTo":
      return jumpTo(state, command.key);
    case "playerMoved":
      return playerMoved(state, command.key);
    case "move":
      return move(state, command);
    case "remove":
      return remove(state, command.key);
    case "removeTracks":
      return removeTracks(state, command.trackIds);
    case "settled":
      return settled(state, command.trackId, command.becomes, passOver);
  }
};

/**
 * An Up Next entry ([key]) moved between two neighbours, named by key rather
 * than by position, so the move means the same once a track change or a
 * removal has shifted the positions. It goes right after [after] while that
 * one is still upcoming, else right before [before], else to the top of Up
 * Next. Null neighbours: dropped at the top ([after]) or the bottom ([before]).
 */
export interface UpNextMove {
  readonly key: string;
  readonly after: string | null;
  readonly before: string | null;
}

/** A move dropped in Up Next that the queue may not have taken yet. */
export type PendingMove = UpNextMove;

/** The move a drop of [key] at [toUpNextIndex] in [state]'s Up Next makes (clamped to the list). */
export const upNextMove = (state: QueueState, key: string, toUpNextIndex: number): UpNextMove => {
  const others = upNext(state).filter((entry) => entry.key !== key);
  const to = Math.max(0, Math.min(Math.trunc(toUpNextIndex), others.length));
  return { key, after: others[to - 1]?.key ?? null, before: others[to]?.key ?? null };
};

/**
 * The queue as Up Next shows it while moves are on their way to the player:
 * the queue with each pending move applied on top. A move the queue already
 * has changes nothing, so the list never shows the old order in between.
 */
export const withPendingMoves = (state: QueueState, moves: readonly PendingMove[]): QueueState =>
  moves.reduce((current, pending) => move(current, pending).state, state);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const parseContext = (value: unknown): QueueContext | null | undefined => {
  if (value === null) return null;
  if (!isRecord(value) || typeof value["kind"] !== "string") return undefined;
  const id = value["id"];
  if (id !== null && typeof id !== "string") return undefined;
  return { kind: value["kind"], id };
};

const parseEntry = (value: unknown, nextKey: number): QueueEntry | null => {
  if (!isRecord(value)) return null;
  const { key, trackId, contextIndex } = value;
  if (typeof key !== "string" || typeof trackId !== "string") return null;
  if (contextIndex !== null && !Number.isInteger(contextIndex)) return null;
  // Keys come from the counter, so a restored queue keeps handing out fresh ones.
  if (!/^\d+$/.test(key) || Number(key) >= nextKey) return null;
  return { key, trackId, contextIndex: contextIndex as number | null };
};

/** Reads a saved queue (e.g. `JSON.parse` of a snapshot), or null when it isn't a valid one. */
export const parseQueueState = (value: unknown): QueueState | null => {
  if (!isRecord(value)) return null;
  const { entries, index, shuffle, repeat, nextKey } = value;
  const context = parseContext(value["context"]);
  if (context === undefined || typeof shuffle !== "boolean") return null;
  if (repeat !== "off" && repeat !== "all" && repeat !== "one") return null;
  if (typeof nextKey !== "number" || !Number.isInteger(nextKey) || nextKey < 1) return null;
  if (!Array.isArray(entries) || typeof index !== "number" || !Number.isInteger(index)) return null;
  const parsed: QueueEntry[] = [];
  const keys = new Set<string>();
  for (const raw of entries) {
    const entry = parseEntry(raw, nextKey);
    if (entry === null || keys.has(entry.key)) return null;
    keys.add(entry.key);
    parsed.push(entry);
  }
  const validIndex = parsed.length === 0 ? index === -1 : index >= 0 && index < parsed.length;
  if (!validIndex) return null;
  return { context, entries: parsed, index, shuffle, repeat, nextKey };
};

/** The entry playing now, if any. */
export const currentEntry = (state: QueueState): QueueEntry | null =>
  state.entries[state.index] ?? null;

/** The entries after the current one, in play order. */
export const upNext = (state: QueueState): readonly QueueEntry[] =>
  state.entries.slice(state.index + 1);
