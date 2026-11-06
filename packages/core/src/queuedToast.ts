import { en, type Catalogue } from "./catalogueEn.ts";
import type { PassOver, QueueCommand } from "./queue.ts";

/** Passes over nothing: every song goes in. */
const takesAll: PassOver = () => false;

/**
 * The toast confirming an Add to Queue or a Play Next started on the phone:
 * how many of [command]'s songs went in, leaving out those the queue passes
 * over ([passOver], explicit songs while Don't play explicit is on). Null for
 * any other command, and when none went in.
 */
export const queuedToast = (
  command: QueueCommand,
  passOver: PassOver = takesAll,
  catalogue: Catalogue = en,
): string | null => {
  if (command.type !== "addToQueue" && command.type !== "playNext") return null;
  const count = command.trackIds.filter((trackId) => !passOver(trackId)).length;
  if (count === 0) return null;
  const text = catalogue.itemActions;
  if (command.type === "addToQueue")
    return count === 1 ? text.addedToQueue : text.addedSongsToQueue(count);
  return count === 1 ? text.playingNext : text.playingSongsNext(count);
};
