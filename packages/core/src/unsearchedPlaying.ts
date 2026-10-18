/**
 * Playing unsearched songs (docs/spec.md, YT Music, "Unavailable entries"):
 * a playlist's songs a Spotify import listed are searched on YouTube Music
 * as they're about to play. Which songs of the queue are searched, and with
 * what priority in the shared search allowance, and how a queue command goes
 * through them while the playing one is searched (`startPlayingWalk`).
 */

import {
  isUnsearchedTrackId,
  readUnsearchedTrackId,
  type UnsearchedSong,
} from "./playlistEntries.ts";
import { explicitSkipNotice } from "./explicitPlayback.ts";
import { counted } from "./listening.ts";
import type { QueueList } from "./playerSync.ts";
import {
  reduceQueue,
  type PassOver,
  type QueueCommand,
  type QueueEntry,
  type QueuePlayback,
  type QueueResult,
  type QueueState,
} from "./queue.ts";
import type { SearchAsker, SearchFailure } from "./searchAllowance.ts";
import { unsearchedSearchQuery, type UnsearchedSettlement } from "./unsearchedEntries.ts";
import { ytTrackId, type YtSong } from "./ytMusic.ts";
import { playerErrorNotice, type PlayerErrorCode } from "./ytQueue.ts";

/** How many songs of the queue are searched ahead: the playing one and the next 3. */
export const PLAYING_SEARCHES = 4;

/** After a failed search, the song isn't asked again by the queue for this long. */
export const PLAYING_SEARCH_RETRY_MS = 30_000;

/** One search for an unsearched song of the queue. */
export interface PlayingSearch {
  /** The song's id in the queue (`unsearchedTrackId`). */
  readonly trackId: string;
  readonly song: UnsearchedSong;
  /** What is sent: its title and artists (`unsearchedSearchQuery`). */
  readonly query: string;
  /** Its priority in the shared search allowance: playing, the first. */
  readonly asker: SearchAsker;
}

/** The searches the app has going for the queue, and when each one that failed did. */
export interface PlayingSearching {
  readonly asking?: ReadonlySet<string>;
  readonly failedAt?: ReadonlyMap<string, number>;
  /** The playing song reached the crossfade's prefetch point: the next song is due now. */
  readonly nextDue?: boolean;
}

/**
 * What the native player holds of [state]'s queue (for `planPlayerSync`):
 * every entry but the unsearched ones, which it has nothing to play by until
 * a search finds them (`settled` then gives the entry its YT Music id, and it
 * joins the player under its own key). The player passes over one still
 * unsearched, as it plays along. Null while the playing entry is unsearched:
 * the player waits for its search.
 */
export const playerQueueList = (state: QueueState): QueueList | null => {
  const current = state.entries[state.index];
  if (current !== undefined && isUnsearchedTrackId(current.trackId)) return null;
  const holds = state.entries.filter(held);
  return {
    keys: holds.map((entry) => entry.key),
    index: current === undefined ? -1 : holds.indexOf(current),
  };
};

/** Whether the player can hold [entry]: anything but an unsearched song. */
const held = (entry: QueueEntry): boolean => !isUnsearchedTrackId(entry.trackId);

/**
 * [state] with its playing entry one the player holds, for a queue that
 * can't wait for a search (picked back up after a restart, paused, or run
 * out on an unsearched song): the first held entry after the playing one,
 * else the last held before it, else none (-1). Unchanged when the playing
 * entry is held already. Going [back] (Previous), the last held entry
 * before it comes first instead.
 */
export const withHeldCurrent = (state: QueueState, way: PlayingWay = "on"): QueueState => {
  const current = state.entries[state.index];
  if (current === undefined || !isUnsearchedTrackId(current.trackId)) return state;
  const after = state.entries.findIndex((entry, at) => at > state.index && held(entry));
  let before = state.index - 1;
  while (before >= 0 && !held(state.entries[before]!)) before -= 1;
  const index = way === "back" ? (before >= 0 ? before : after) : after >= 0 ? after : before;
  return { ...state, index };
};

/**
 * The queue to pick back up when JS restarts while the player kept going:
 * [saved], the queue saved last, once the player holds what it holds
 * ([playerKeys]), with its playing entry one the player holds
 * (`withHeldCurrent`: it was saved while its playing song was searched).
 * Null when the player holds something else.
 */
export const keptQueue = (saved: QueueState, playerKeys: readonly string[]): QueueState | null => {
  const state = withHeldCurrent(saved);
  const keys = playerQueueList(state)?.keys ?? [];
  const same = keys.length === playerKeys.length && keys.every((key, i) => key === playerKeys[i]);
  return same ? state : null;
};

/** Which way the queue goes past songs that don't play: on, or back for Previous. */
export type PlayingWay = "on" | "back";

/**
 * What the queue does once the playing song's search answered: found, it
 * plays; not found (it's unavailable now) or failed, the next song plays
 * and a notice names the song skipped. A song the owner chose ([chosen]: a
 * tap, Play, Shuffle, an Up Next entry) that couldn't be searched because
 * Wave is offline or YT Music is off says what a YT Music song says then,
 * and nothing plays instead ("stay": the queue is as it was). One skipped
 * to says it too, and playback stops there ("stop"), since the songs after
 * it couldn't be searched either.
 */
export type PlayingAnswerStep =
  | { readonly kind: "play" }
  | { readonly kind: "skip"; readonly notice: string }
  | { readonly kind: "stay"; readonly notice: string }
  | { readonly kind: "stop"; readonly notice: string };

const SKIPPED_BECAUSE: Readonly<Record<SearchFailure | "notFound", string>> = {
  notFound: "it isn't on YouTube Music",
  failed: "YouTube Music didn't answer",
  offline: "you're offline",
  disabled: "YT Music is off",
};

const STAY_CODES: Readonly<Partial<Record<SearchFailure, PlayerErrorCode>>> = {
  offline: "ytOffline",
  disabled: "ytDisabled",
};

export const playingAnswerStep = <S extends YtSong>(
  song: UnsearchedSong,
  settlement: UnsearchedSettlement<S>,
  { chosen }: { readonly chosen: boolean },
): PlayingAnswerStep => {
  if (settlement.kind === "found") return { kind: "play" };
  const why = settlement.kind === "notFound" ? "notFound" : settlement.reason;
  const code = settlement.kind === "failed" ? STAY_CODES[settlement.reason] : undefined;
  if (code !== undefined)
    return { kind: chosen ? "stay" : "stop", notice: playerErrorNotice(code) };
  return { kind: "skip", notice: `Skipped "${song.title}": ${SKIPPED_BECAUSE[why]}.` };
};

/**
 * A queue command's way through unsearched songs while it waits for the
 * playing one's search: the queue shows the song as playing meanwhile.
 */
export interface PlayingWalk {
  /** The queue before the command, which a song that can't be searched goes back to. */
  readonly before: QueueState;
  /** The queue now, its playing entry the unsearched song being searched. */
  readonly state: QueueState;
  readonly playback: QueuePlayback;
  /** Whether the owner chose the song the command made current (`chosenBy`). */
  readonly chosen: boolean;
  /** The way the command went: back for Previous, on for the rest. */
  readonly way: PlayingWay;
  /** The songs (by track id) searched on the way so far. */
  readonly asked: readonly string[];
}

/**
 * What the queue does next on its way through unsearched songs:
 * - `search`: wait for [song]'s search (the playing entry of [walk].state),
 *   then `answerPlayingWalk`.
 * - `go`: the queue becomes [state], with [playback], and the player follows.
 * - `stay`: the song couldn't be searched; the queue is [state], as it was.
 * [notice], when not null, is shown first.
 */
export type PlayingStep = (
  | {
      readonly kind: "search";
      readonly trackId: string;
      readonly song: UnsearchedSong;
      readonly walk: PlayingWalk;
      readonly state: QueueState;
    }
  | { readonly kind: "go"; readonly state: QueueState; readonly playback: QueuePlayback }
  | { readonly kind: "stay"; readonly state: QueueState }
) & { readonly notice: string | null };

/** The walk's next step from its queue now: search its playing song, or go. */
const visit = (walk: PlayingWalk, notice: string | null): PlayingStep => {
  const current = walk.state.entries[walk.state.index];
  const song = current === undefined ? null : readUnsearchedTrackId(current.trackId);
  if (current === undefined || song === null) {
    return { kind: "go", state: walk.state, playback: walk.playback, notice };
  }
  // Gone round the queue, or it ran out, on songs that didn't play.
  if (walk.playback === "stop" || walk.asked.includes(current.trackId)) {
    return { kind: "go", state: withHeldCurrent(walk.state, walk.way), playback: "stop", notice };
  }
  const asking = { ...walk, asked: [...walk.asked, current.trackId] };
  return {
    kind: "search",
    trackId: current.trackId,
    song,
    walk: asking,
    state: walk.state,
    notice,
  };
};

/**
 * What the queue does after [command] made [before] into [reduced]
 * (`reduceQueue`): go there, or, with an unsearched song playing, search it
 * first (`answerPlayingWalk` takes the answer). [pending] is the walk still
 * waiting for its search when the command came, if any: the command takes
 * its place. Leaving the same song playing, the walk goes on with it, the
 * same search ("search" again for that song: join the one going on).
 * Making another unsearched song play, the new walk goes back, if it must,
 * to the queue the player holds ([pending].before).
 */
export const startPlayingWalk = (
  before: QueueState,
  command: QueueCommand,
  reduced: QueueResult,
  pending: PlayingWalk | null,
): PlayingStep => {
  const { state, playback } = reduced;
  if (pending !== null && sameCurrent(pending.state, state)) {
    // Only what the command changes besides: Up Next, the modes, songs settled.
    const goesOn = playback === "keep" ? pending.playback : playback;
    return visit({ ...pending, state, playback: goesOn, asked: pending.asked.slice(0, -1) }, null);
  }
  const chosen = chosenBy(command, before);
  const way = command.type === "previous" ? "back" : "on";
  const playerHolds = pending?.before ?? before;
  return visit({ before: playerHolds, state, playback, chosen, way, asked: [] }, null);
};

const sameCurrent = (a: QueueState, b: QueueState): boolean => {
  const current = a.entries[a.index];
  return current !== undefined && b.entries[b.index]?.key === current.key;
};

/**
 * Whether the owner chose the entry [command] makes current (a tap, Play,
 * Shuffle, an Up Next entry, a first song queued): tapped while it can't be
 * searched, an unsearched song says why and nothing changes. Skips and the
 * player moving on go past it instead.
 */
const chosenBy = (command: QueueCommand, before: QueueState): boolean =>
  command.type === "play" ||
  command.type === "jumpTo" ||
  ((command.type === "playNext" || command.type === "addToQueue") && before.index < 0);

/**
 * What the queue does once [walk]'s playing song's search answered
 * [settlement]. Found as a song [passOver] passes over (an explicit one,
 * while Don't play explicit is on), it's skipped as one not found is, and
 * the notice says it's explicit (`explicitSkipNotice`).
 */
export const answerPlayingWalk = <S extends YtSong>(
  walk: PlayingWalk,
  settlement: UnsearchedSettlement<S>,
  passOver: PassOver = () => false,
): PlayingStep => {
  const current = walk.state.entries[walk.state.index]!;
  const song = readUnsearchedTrackId(current.trackId)!;
  // Found as a song that doesn't play (an explicit one): it goes as one not found does.
  const passed =
    settlement.kind === "found" && passOver(ytTrackId(settlement.becomes.song.videoId));
  if (settlement.kind === "found" && !passed) {
    const becomes = ytTrackId(settlement.becomes.song.videoId);
    const { state } = reduceQueue(walk.state, {
      type: "settled",
      trackId: current.trackId,
      becomes,
    });
    return visit({ ...walk, state }, null);
  }
  // Only the song the command made current was chosen; those after it come as skips do.
  const chosen = walk.chosen && walk.asked.length === 1;
  const step: PlayingAnswerStep = passed
    ? { kind: "skip", notice: explicitSkipNotice(song.title) }
    : playingAnswerStep(song, settlement, { chosen });
  if (step.kind === "stay") return { kind: "stay", state: walk.before, notice: step.notice };
  // The songs after it can't be searched either: none is asked, nor named.
  if (step.kind === "stop") {
    const state = withHeldCurrent(walk.state, walk.way);
    return { kind: "go", state, playback: "stop", notice: step.notice };
  }
  const notice = step.kind === "play" ? null : step.notice;
  // On the way the command went: Next and the rest go on, Previous goes back.
  const moved = reduceQueue(
    walk.state,
    walk.way === "back" ? { type: "previous", positionMs: 0 } : { type: "next" },
  );
  const next =
    settlement.kind === "notFound" || passed
      ? reduceQueue(walk.way === "back" ? moved.state : walk.state, {
          type: "settled",
          trackId: current.trackId,
          becomes: null,
        })
      : moved;
  const playback = next.playback === "stop" ? "stop" : walk.playback;
  return visit({ ...walk, state: next.state, playback }, notice);
};

/**
 * What to say when the player went on from [before]'s playing entry to
 * [after]'s past songs still unsearched (it holds none of them, so it plays
 * along without them): their search hasn't found them in time, so they're
 * skipped as a failed search skips them. Null when it passed over none (or
 * went back).
 */
export const passedOverNotice = (before: QueueState, after: QueueState): string | null => {
  const from = before.entries[before.index];
  if (from === undefined) return null;
  const start = after.entries.findIndex((entry) => entry.key === from.key);
  if (start < 0 || after.index <= start + 1) return null;
  const songs = after.entries.slice(start + 1, after.index).flatMap((entry) => {
    const song = readUnsearchedTrackId(entry.trackId);
    return song === null ? [] : [song];
  });
  const [first] = songs;
  if (first === undefined) return null;
  const because = SKIPPED_BECAUSE.failed;
  return songs.length === 1
    ? `Skipped "${first.title}": ${because}.`
    : `Skipped ${counted(songs.length, "song")}: ${because}.`;
};

/** The entries from the playing one on, `PLAYING_SEARCHES` of them, wrapping with repeat all. */
const nearEntries = (state: QueueState): QueueEntry[] => {
  const { entries, index, repeat } = state;
  if (index < 0) return [];
  const near: QueueEntry[] = [];
  const count = Math.min(PLAYING_SEARCHES, entries.length);
  for (let step = 0; near.length < count; step += 1) {
    const at = index + step;
    if (at >= entries.length && repeat !== "all") break;
    const entry = entries[at % entries.length];
    if (entry === undefined) break;
    near.push(entry);
  }
  return near;
};

/**
 * What to search now for [state]'s queue, at [now] (ms): the unsearched
 * songs among the playing one and the next 3 in play order (the shuffled
 * order when shuffle is on, the top again after the end with repeat all),
 * each once, the playing one first, all with the playing priority. A song
 * being searched ([searching].asking) isn't asked again, nor is one whose
 * search failed in the last `PLAYING_SEARCH_RETRY_MS`, except the next
 * song once [searching].nextDue: the playing song reached the crossfade's
 * prefetch point (`crossfadePrefetchAt`), and the next must reach the player
 * before the overlap.
 */
export const playingSearches = (
  state: QueueState,
  { asking, failedAt, nextDue = false }: PlayingSearching,
  now: number,
): PlayingSearch[] => {
  const seen = new Set<string>();
  const searches: PlayingSearch[] = [];
  for (const [at, { trackId }] of nearEntries(state).entries()) {
    if (seen.has(trackId)) continue;
    seen.add(trackId);
    const song = readUnsearchedTrackId(trackId);
    if (song === null || asking?.has(trackId) === true) continue;
    const failed = failedAt?.get(trackId);
    const due = nextDue && at === 1;
    if (!due && failed !== undefined && now - failed < PLAYING_SEARCH_RETRY_MS) continue;
    searches.push({ trackId, song, query: unsearchedSearchQuery(song), asker: "playing" });
  }
  return searches;
};
