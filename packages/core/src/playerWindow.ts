/**
 * The window of the queue the native player holds. Every change to the
 * player's list costs work on the whole list on the main thread (the
 * controller, the player, the session and `MediaSession.setQueue`), so a long
 * queue stays whole in Core and JS, and the player holds the songs around the
 * playing one. The window moves after each song change (`planPlayerSync`).
 */

import type { QueueList } from "./playerSync.ts";
import { isUnsearchedTrackId } from "./playlistEntries.ts";
import { lapEntries, type QueueState, type RepeatMode } from "./queue.ts";
import { playerQueueList } from "./unsearchedPlaying.ts";

/** The most songs the player holds; a queue this short or shorter loads whole. */
export const PLAYER_WINDOW_SIZE = 100;

/** How many songs the window keeps behind the playing one. */
export const PLAYER_WINDOW_BEHIND = 30;

/** How many songs the window keeps after the playing one, which takes the last of its 100 places. */
export const PLAYER_WINDOW_AHEAD = PLAYER_WINDOW_SIZE - PLAYER_WINDOW_BEHIND - 1;

/**
 * The window around the playing song of a queue with Repeat All: past the
 * last song it goes on with the next lap's songs (the song the player goes on
 * to there opens that lap, as `playerMoved` expects), and before the first it
 * holds the last songs, where previous goes. No song is held twice.
 */
const wrappedWindow = (list: QueueList, state: QueueState): QueueList => {
  const taken = new Set([list.keys[list.index]!]);
  const held = new Set(list.keys);
  const lap = lapEntries(state)
    .map((entry) => entry.key)
    .filter((key) => held.has(key));
  const ahead: string[] = [];
  for (const key of [...list.keys.slice(list.index + 1), ...lap]) {
    if (ahead.length === PLAYER_WINDOW_AHEAD) break;
    if (taken.has(key)) continue;
    taken.add(key);
    ahead.push(key);
  }
  const behind: string[] = [];
  const size = list.keys.length;
  for (let back = 1; back < size && behind.length < PLAYER_WINDOW_BEHIND; back += 1) {
    const key = list.keys[(list.index - back + size) % size]!;
    if (taken.has(key)) continue;
    taken.add(key);
    behind.unshift(key);
  }
  return { keys: [...behind, list.keys[list.index]!, ...ahead], index: behind.length };
};

/**
 * The part of the queue the player should hold (`playerQueueList`, whose
 * songs it narrows to the window), or null while the playing song is being
 * searched and the player waits.
 */
export const playerQueueWindow = (state: QueueState): QueueList | null => {
  const list = playerQueueList(state);
  if (list === null || list.index < 0 || list.keys.length <= PLAYER_WINDOW_SIZE) return list;
  if (state.repeat === "all") return wrappedWindow(list, state);
  const from = Math.max(0, list.index - PLAYER_WINDOW_BEHIND);
  return {
    keys: list.keys.slice(from, list.index + PLAYER_WINDOW_AHEAD + 1),
    index: list.index - from,
  };
};

/**
 * The repeat mode the player itself should run. Repeat All on a queue longer
 * than the window stays off there, since the player would only repeat its
 * window; the window wraps through the queue's start instead.
 */
export const playerRepeatMode = (state: QueueState): RepeatMode =>
  state.repeat === "all" &&
  state.entries.filter((entry) => !isUnsearchedTrackId(entry.trackId)).length > PLAYER_WINDOW_SIZE
    ? "off"
    : state.repeat;
