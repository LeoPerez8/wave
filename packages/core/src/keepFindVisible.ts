/**
 * Keep Find Field Visible (Settings › Layout, docs/spec.md "Find in
 * Playlist"): off by default, a list's Find field waits above its head until
 * the list is pulled down, as in Apple Music; on, the field stays pinned
 * under the page's header while the list scrolls under it.
 */

/** Whether the switch is on, from what the key-value store holds (null: nothing, off). */
export const readKeepFindVisible = (stored: string | null): boolean => stored === "on";

/** What to store for the switch: nothing when off, so it reads back (and syncs) as the default. */
export const storedKeepFindVisible = (on: boolean): string | null => (on ? "on" : null);

/** Where a findable list starts and how tall its content is kept. */
export interface FindFieldPlacement {
  /** The scroll the list opens at: past the field when it's in the list, else its top. */
  readonly initialOffset: number;
  /**
   * The content's least height, so the field in the list can always scroll
   * out of sight however short the list; none when the field is pinned.
   */
  readonly minHeight: number | undefined;
}

/**
 * How a findable list is laid out: with the field at its top ([pinned]
 * false) the list opens scrolled just past it; pinned, the field isn't in
 * the list, which opens at its top.
 */
export const findFieldPlacement = ({
  pinned,
  fieldHeight,
  viewportHeight,
}: {
  readonly pinned: boolean;
  readonly fieldHeight: number;
  readonly viewportHeight: number;
}): FindFieldPlacement =>
  pinned
    ? { initialOffset: 0, minHeight: undefined }
    : { initialOffset: fieldHeight, minHeight: viewportHeight + fieldHeight };

/**
 * The scroll an open list at [offset] moves to as the switch turns [pinned]
 * on or off: the field ([fieldHeight] tall) leaves or rejoins the top of the
 * list, so the rows on screen stay where they were. Pinning a list showing
 * any of its field lands on its top.
 */
export const findScrollOnPin = (offset: number, fieldHeight: number, pinned: boolean): number =>
  pinned ? Math.max(0, offset - fieldHeight) : offset + fieldHeight;
