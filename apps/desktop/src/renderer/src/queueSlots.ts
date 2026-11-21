import type { MagicQueueStatus } from "../../shared/ytPages.ts";

/** Placeholder rows drawn while a Magic Queue batch loads. */
export const PLACEHOLDERS = 3;

/** How the Magic Queue's next batch goes: its seed's name (null: none plays) and status. */
export interface MagicBatch {
  readonly seed: string | null;
  readonly status: MagicQueueStatus;
}

export type QueueSlot =
  | { readonly kind: "historyHead" }
  | { readonly kind: "nowPlayingHead" }
  /** Up Next's heading: its song count, and the seed of the Magic Queue it holds. */
  | { readonly kind: "upNext"; readonly count: number; readonly seed: string | null }
  | { readonly kind: "note"; readonly note: "nothingUpNext" | "noSongsFound" | "couldntLoad" }
  | { readonly kind: "placeholder" }
  | { readonly kind: "row"; readonly at: number };

/**
 * The Queue panel's list as drawn: History, Now Playing and Up Next, each under its heading.
 * Under a Magic Queue's songs, placeholder rows while its batch loads, or the line saying it came
 * back empty or failed; with no song up next and none of those, "Nothing up next."
 */
export const queueSlots = (index: number, length: number, batch: MagicBatch): QueueSlot[] => {
  if (length === 0) return [];
  const slots: QueueSlot[] = [];
  if (index > 0) {
    slots.push({ kind: "historyHead" });
    for (let at = 0; at < index; at++) slots.push({ kind: "row", at });
  }
  slots.push({ kind: "nowPlayingHead" }, { kind: "row", at: index });
  slots.push({ kind: "upNext", count: length - index - 1, seed: batch.seed });
  for (let at = index + 1; at < length; at++) slots.push({ kind: "row", at });
  const magic = batch.seed === null ? "idle" : batch.status;
  if (magic === "loading")
    for (let n = 0; n < PLACEHOLDERS; n++) slots.push({ kind: "placeholder" });
  else if (magic === "empty") slots.push({ kind: "note", note: "noSongsFound" });
  else if (magic === "failed") slots.push({ kind: "note", note: "couldntLoad" });
  else if (index === length - 1) slots.push({ kind: "note", note: "nothingUpNext" });
  return slots;
};

/** Where queue row [at] sits among the slots, the playing one at [index]. */
export const slotOf = (at: number, index: number): number =>
  at + (index > 0 ? 1 : 0) + (at >= index ? 1 : 0) + (at > index ? 1 : 0);

/**
 * Whether the playing row, [row] tall at [y], is out of a [height] list scrolled to [top]: "up"
 * when it is above the view, "down" when below, null while any of it shows (or the list isn't
 * laid out).
 */
export const playingOffView = (
  y: number,
  row: number,
  top: number,
  height: number,
): "up" | "down" | null => {
  if (height <= 0) return null;
  if (y + row <= top) return "up";
  if (y >= top + height) return "down";
  return null;
};
