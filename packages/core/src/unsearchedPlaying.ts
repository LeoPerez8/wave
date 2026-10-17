/**
 * Playing unsearched songs (docs/spec.md, YT Music, "Unavailable entries"):
 * a playlist's songs a Spotify import listed are searched on YouTube Music
 * as they're about to play. Which songs of the queue are searched, and with
 * what priority in the shared search allowance.
 */

import {
  isUnsearchedTrackId,
  readUnsearchedTrackId,
  type UnsearchedSong,
} from "./playlistEntries.ts";
import { counted } from "./listening.ts";
import type { QueueList } from "./playerSync.ts";
import type { QueueEntry, QueueState } from "./queue.ts";
import type { SearchAsker, SearchFailure } from "./searchAllowance.ts";
import { unsearchedSearchQuery, type UnsearchedSettlement } from "./unsearchedEntries.ts";
import type { YtSong } from "./ytMusic.ts";
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
  const held = state.entries.filter((entry) => !isUnsearchedTrackId(entry.trackId));
  return {
    keys: held.map((entry) => entry.key),
    index: current === undefined ? -1 : held.indexOf(current),
  };
};

/**
 * What the queue does once the playing song's search answered: found, it
 * plays; not found (it's unavailable now) or failed, the next song plays
 * and a notice names the song skipped. A song the owner chose ([chosen]: a
 * tap, Play, Shuffle, an Up Next entry) that couldn't be searched because
 * Wave is offline or YT Music is off says what a YT Music song says then,
 * and nothing plays instead ("stay": the queue is as it was).
 */
export type PlayingAnswerStep =
  | { readonly kind: "play" }
  | { readonly kind: "skip"; readonly notice: string }
  | { readonly kind: "stay"; readonly notice: string };

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
  if (chosen && code !== undefined) return { kind: "stay", notice: playerErrorNotice(code) };
  return { kind: "skip", notice: `Skipped "${song.title}": ${SKIPPED_BECAUSE[why]}.` };
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
 * search failed in the last `PLAYING_SEARCH_RETRY_MS`.
 */
export const playingSearches = (
  state: QueueState,
  { asking, failedAt }: PlayingSearching,
  now: number,
): PlayingSearch[] => {
  const seen = new Set<string>();
  const searches: PlayingSearch[] = [];
  for (const { trackId } of nearEntries(state)) {
    if (seen.has(trackId)) continue;
    seen.add(trackId);
    const song = readUnsearchedTrackId(trackId);
    if (song === null || asking?.has(trackId) === true) continue;
    const failed = failedAt?.get(trackId);
    if (failed !== undefined && now - failed < PLAYING_SEARCH_RETRY_MS) continue;
    searches.push({ trackId, song, query: unsearchedSearchQuery(song), asker: "playing" });
  }
  return searches;
};
