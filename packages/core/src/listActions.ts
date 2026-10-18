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
  /**
   * The Library | Online toggle ending the line, if it has one: its width
   * with its segments' labels, and with their icons alone.
   */
  readonly toggle?: {
    readonly labelled: number | undefined;
    readonly icons: number | undefined;
  };
}

/** How the Library | Online toggle shows: its segments' icons and labels, or their icons alone. */
export type OnlineToggleForm = "labelled" | "icons";

/** The forms of a line's last action and toggle; null for one it hasn't, or not measured yet. */
export interface ListActionsForms {
  readonly last: ListActionForm | null;
  readonly toggle: OnlineToggleForm | null;
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
export const lastListActionForm = (room: ListActionsRoom, label: string): ListActionForm | null =>
  fits(room, [...room.before, room.last[label]]);

/**
 * Whether [widths] fit on the line side by side, a gap between each two:
 * "labelled" or "icon", or null while one of them isn't measured.
 */
const fits = (room: ListActionsRoom, widths: readonly (number | undefined)[]) => {
  if (room.line === undefined || widths.some((width) => width === undefined)) return null;
  const total =
    widths.reduce((sum: number, width) => sum + (width ?? 0), 0) + room.gap * (widths.length - 1);
  return total <= room.line + ROUNDING ? "labelled" : "icon";
};

/**
 * The forms of the line's last action (saying [label], null when the line
 * has none) and of the Library | Online toggle ending it (`room.toggle`).
 * When everything doesn't fit with its labels, the toggle shows its icons
 * alone first; then the last action keeps its label if it fits beside them,
 * as `lastListActionForm` decides it without a toggle. Both wait (null)
 * until every width is measured.
 */
export const listActionsForms = (room: ListActionsRoom, label: string | null): ListActionsForms => {
  const { toggle } = room;
  const last = label === null ? [] : [room.last[label]];
  if (toggle === undefined)
    return { last: label === null ? null : lastListActionForm(room, label), toggle: null };
  const all = fits(room, [...room.before, ...last, toggle.labelled]);
  // The last action's form beside the toggle's icons alone.
  const besideIcons = fits(room, [...room.before, ...last, toggle.icons]);
  if (all === null || besideIcons === null) return { last: null, toggle: null };
  const lastForm = label === null ? null : all === "labelled" ? "labelled" : besideIcons;
  return { last: lastForm, toggle: all === "labelled" ? "labelled" : "icons" };
};
