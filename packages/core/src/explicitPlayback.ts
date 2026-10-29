/**
 * Don't play explicit (docs/spec.md, "Explicit songs"): a switch in
 * Settings › Playback, off by default. On, the queue passes over explicit
 * songs (`reduceQueue`'s `PassOver`): a play, Play Next, Add to Queue or
 * More from this artist leaves them out, a tapped one gives way to the next
 * clean song, and an unsearched song found as one is skipped. Lists still
 * show them, with their badge. Unknown counts as clean and plays.
 */

import { en, type Catalogue } from "./catalogueEn.ts";
import { isExplicit, type ExplicitFlag } from "./explicit.ts";
import type { PassOver, QueueCommand, QueueState } from "./queue.ts";

/** What Don't play explicit goes by. */
export interface ExplicitPlayback {
  /** Whether the switch is on. */
  readonly on: boolean;
  /**
   * A track's flag, by track id: a Library song's, or a YT Music song's mark;
   * undefined for a song nothing says about (it counts as clean).
   */
  readonly flagOf: (trackId: string) => ExplicitFlag | boolean | undefined;
}

/** The songs the queue passes over: explicit ones while the switch is on, else none. */
export const explicitPassOver =
  ({ on, flagOf }: ExplicitPlayback): PassOver =>
  (trackId) =>
    on && isExplicit(flagOf(trackId) ?? "unknown");

/**
 * The songs of [state]'s queue [passOver] passes over, each once, in queue
 * order: what leaves the queue as Don't play explicit turns on (the queue's
 * `removeTracks`).
 */
export const queuedPassedOver = (state: QueueState, passOver: PassOver): string[] => [
  ...new Set(state.entries.map((entry) => entry.trackId).filter(passOver)),
];

/** What an unsearched song found as an explicit one says as it's skipped. */
export const explicitSkipNotice = (title: string, catalogue: Catalogue = en): string =>
  catalogue.playbackText.explicitSkipped(title);

/**
 * What [command] says once the queue passed over its songs ([passOver]),
 * by their titles ([titleOf]): a tapped explicit song was skipped (or, with
 * no clean song to play instead, didn't play), or a play, Play Next or Add to
 * Queue of explicit songs alone did nothing. Null when it played or queued
 * something, or passed nothing over: a list's explicit songs go quietly.
 */
export const explicitPlayNotice = (
  command: QueueCommand,
  passOver: PassOver,
  titleOf: (trackId: string) => string,
  catalogue: Catalogue = en,
): string | null => {
  if (command.type !== "play" && command.type !== "playNext" && command.type !== "addToQueue") {
    return null;
  }
  const { trackIds } = command;
  const clean = trackIds.some((trackId) => !passOver(trackId));
  const text = catalogue.playbackText;
  const play = command.type === "play";
  const tapped = play ? command.startIndex : undefined;
  const chosen = tapped === undefined ? undefined : trackIds[tapped];
  if (chosen !== undefined && passOver(chosen)) {
    return clean
      ? explicitSkipNotice(titleOf(chosen), catalogue)
      : text.explicitNotPlayed(titleOf(chosen));
  }
  if (clean || trackIds.length === 0) return null;
  const [only] = trackIds;
  if (trackIds.length === 1 && only !== undefined) {
    return play ? text.explicitNotPlayed(titleOf(only)) : text.explicitNotAdded(titleOf(only));
  }
  return play ? text.allExplicitNotPlayed : text.allExplicitNotAdded;
};
