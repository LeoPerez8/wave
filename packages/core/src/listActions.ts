/**
 * The actions under a list's head (Play, Shuffle, then a playlist's or an
 * album's download action) stay on one line. The last one keeps its label
 * when it fits beside the others, and shows its icon alone when it doesn't.
 */

/** How the last action shows: its icon and label, or its icon alone. */
export type ListActionForm = "labelled" | "icon";

/** What the line measured, in dp. */
export interface ListActionsRoom {
  /** The width the line gives its actions (a playlist's menu button already taken out). */
  readonly line: number | undefined;
  /** The space between two actions. */
  readonly gap: number;
  /** The actions before the last (Play, Shuffle) with their labels, in order. */
  readonly before: readonly (number | undefined)[];
  /** The last action with its label, by label: every label it can say, measured ahead. */
  readonly last: { readonly [label: string]: number | undefined };
}

/** Layout rounds each width to the pixel; a fit this close is a fit. */
const ROUNDING = 0.5;

/**
 * The form of the last action while it says [label]: labelled when Play,
 * Shuffle and it fit on the line with their labels, else its icon alone.
 * Null while the line or one of the widths isn't measured yet: the action
 * waits rather than show a form it might have to leave a frame later. Every
 * label being measured ahead, a change of state (Download, Cancel, Retry
 * Failed) settles its form on its first frame.
 */
export const lastListActionForm = (room: ListActionsRoom, label: string): ListActionForm | null => {
  const widths = [...room.before, room.last[label]];
  if (room.line === undefined || widths.some((width) => width === undefined)) return null;
  const total =
    widths.reduce((sum: number, width) => sum + (width ?? 0), 0) + room.gap * (widths.length - 1);
  return total <= room.line + ROUNDING ? "labelled" : "icon";
};
