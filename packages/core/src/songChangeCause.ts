import type { QueueCommand } from "./queue.ts";

/**
 * What a queue command that moves the player to another song is, for the
 * crossfade's app-log line ("song changed by Next"): the player is told it
 * with the sync that moves it, so a skip can't be taken for a crossfade
 * failure.
 */
export type SongChangeCause =
  | "next"
  | "previous"
  /** A tap on an Up Next row (`jumpTo`). */
  | "queueTap"
  /** A new queue from a list. */
  | "play"
  /** The queue following a move the player made on its own (a song ending, the notification). */
  | "player"
  | "trackEnded"
  /** An unsearched song's search answered. */
  | "search"
  /** Undo on a new queue, or a Recap giving the queue back. */
  | "undo"
  /** A queue saved before Wave's process ended, picked back up. */
  | "restore"
  /** Any other edit: a removal, shuffle, repeat, songs added. */
  | "queue";

/**
 * Where a seek within the playing song came from, for the same log line. The
 * media session's own seeks (the notification, Android Auto, a headset) are
 * named by the player itself.
 */
export type SeekSource =
  | "scrubber"
  | "lyric"
  /** Previous with more than a few seconds played: the song starts over. */
  | "previousRestart"
  | "undo"
  | "restore"
  /** The queue ran out: paused back at the start of its last song. */
  | "queueEnd";

/** What [command] is as the cause of the song change it makes, if it makes one. */
export const songChangeCause = (command: QueueCommand): SongChangeCause => {
  switch (command.type) {
    case "next":
    case "previous":
    case "play":
    case "trackEnded":
      return command.type;
    case "jumpTo":
      return "queueTap";
    case "playerMoved":
      return "player";
    case "settled":
      return "search";
    default:
      return "queue";
  }
};
